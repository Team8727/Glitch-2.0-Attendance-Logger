"use strict";

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const store = require("./store");

const BACKEND_TIMEOUT_MS = 15000;

/* ---------- minimal .env loader (Replit Secrets take precedence) ---------- */

function loadEnvFile() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/* ---------- backend (same Apps Script the QR web app uses) ---------- */

async function api(action, params) {
  const url = new URL(process.env.APPS_SCRIPT_URL);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.set(key, value);
  }
  const Abort = globalThis.AbortController;
  const controller = Abort ? new Abort() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS)
    : null;
  try {
    const res = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller ? controller.signal : undefined,
    });
    const text = await res.text();
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The attendance server timed out — try again in a moment.");
    }
    throw new Error("Could not reach the attendance server. Ask a mentor.");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchRoster() {
  const payload = await api("list", {});
  if (!payload || payload.ok !== true || !Array.isArray(payload.members)) {
    throw new Error((payload && payload.error) || "The roster could not be loaded.");
  }
  return payload.members;
}

/* ---------- command handlers ---------- */

async function handleLink(interaction) {
  const name = interaction.options.getString("name", true).trim();
  let roster;
  try {
    roster = await fetchRoster();
  } catch (err) {
    return interaction.editReply(err.message);
  }
  const match = roster.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    return interaction.editReply(
      `"${name}" isn't on the roster. Ask a mentor to add it, or check the spelling against the roster list.`
    );
  }
  await store.set(interaction.user.id, match.name);
  const subteam = match.subteam ? ` (${match.subteam})` : "";
  return interaction.editReply(
    `Linked your Discord to **${match.name}**${subteam}. You're all set — use \`/signin <code>\` at practice.`
  );
}

async function handleSignIn(interaction) {
  const linkedName = store.get(interaction.user.id);
  if (!linkedName) {
    return interaction.editReply(
      "You're not linked yet. Run `/link <your roster name>` once first."
    );
  }
  const code = interaction.options.getString("code", true);
  await interaction.editReply("Signing you in…");

  let payload;
  try {
    payload = await api("signin", { member: linkedName, code });
  } catch (err) {
    return interaction.editReply(err.message);
  }

  if (!payload || payload.ok !== true) {
    if (payload && payload.already) {
      return interaction.editReply("You're already signed in for today.");
    }
    return interaction.editReply(
      `Sign-in failed: ${(payload && payload.error) || "unknown error — ask a mentor."}`
    );
  }

  const name = payload.name || linkedName;
  await interaction.editReply(`You're signed in, **${name}**. See you at practice!`);
  await postPublicLog(interaction, name);
}

async function handleStatus(interaction) {
  const linkedName = store.get(interaction.user.id);
  if (!linkedName) {
    return interaction.editReply(
      "You're not linked yet. Run `/link <your roster name>` once."
    );
  }
  return interaction.editReply(`You're linked as **${linkedName}**.`);
}

async function postPublicLog(interaction, name) {
  const channelId = process.env.SIGNIN_LOG_CHANNEL_ID;
  if (!channelId) return;
  try {
    const channel =
      interaction.client.channels.cache.get(channelId) ||
      (await interaction.client.channels.fetch(channelId));
    if (channel && channel.isTextBased()) {
      await channel.send(`✅ **${name}** signed in.`);
    }
  } catch (err) {
    console.error("[bot] could not post to log channel:", err.message);
  }
}

/* ---------- startup ---------- */

function requiredEnv() {
  const missing = [];
  if (!process.env.DISCORD_TOKEN) missing.push("DISCORD_TOKEN");
  if (!process.env.CLIENT_ID) missing.push("CLIENT_ID");
  if (!process.env.APPS_SCRIPT_URL) missing.push("APPS_SCRIPT_URL");
  return missing;
}

async function main() {
  loadEnvFile();

  const missing = requiredEnv();
  if (missing.length > 0) {
    console.error(`[startup] Missing required environment variables: ${missing.join(", ")}`);
    console.error("Set them as Replit Secrets or in bot/.env (see bot/.env.example), then restart.");
    process.exit(1);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link your Discord account to your roster name (one-time).")
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("Your name exactly as it appears on the roster.")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("signin")
      .setDescription("Sign in for today's practice.")
      .addStringOption((opt) =>
        opt
          .setName("code")
          .setDescription("Today's practice code (posted in Discord / on the whiteboard).")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show which roster name you're linked to."),
  ].map((cmd) => cmd.toJSON());

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log(
      `[startup] Registered ${commands.length} commands (${
        process.env.GUILD_ID ? "guild " + process.env.GUILD_ID : "global"
      }).`
    );
  } catch (err) {
    console.error("[startup] Failed to register commands:", err.message);
  }

  try {
    const roster = await fetchRoster();
    console.log(`[startup] Backend reachable — roster has ${roster.length} members.`);
  } catch (err) {
    console.error("[startup] Backend not reachable yet:", err.message);
  }

  client.once("ready", () => {
    console.log(`[bot] Logged in as ${client.user.tag}.`);
  });

  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    interaction
      .deferReply({ ephemeral: true })
      .then(async () => {
        const name = interaction.commandName;
        if (name === "link") return handleLink(interaction);
        if (name === "signin") return handleSignIn(interaction);
        if (name === "status") return handleStatus(interaction);
        return interaction.editReply("Unknown command.");
      })
      .catch((err) => {
        console.error("[bot] command error:", err.message);
        return interaction
          .editReply("Something went wrong — try again or ask a mentor.")
          .catch(() => {});
      });
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
