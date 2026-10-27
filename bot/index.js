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
const roster = require("./roster");
const attendance = require("./attendance");
const codes = require("./codes");
const server = require("./server");

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

/* ---------- command handlers ---------- */

async function handleLink(interaction) {
  const name = interaction.options.getString("name", true).trim();
  let match;
  try {
    match = roster.find(name);
  } catch (err) {
    return interaction.editReply(err.message);
  }
  if (!match) {
    return interaction.editReply(
      `"${name}" isn't on the roster. Ask a mentor to add it to data/roster.csv, or check the spelling.`
    );
  }
  await store.set(interaction.user.id, match.name);
  const subteam = match.subteam ? ` (${match.subteam})` : "";
  return interaction.editReply(
    `Linked your Discord to **${match.name}**${subteam}. You're all set — use \`/signin <team number>\` at practice.`
  );
}

async function handleSignIn(interaction) {
  const linkedName = store.get(interaction.user.id);
  if (!linkedName) {
    return interaction.editReply(
      "You're not linked yet. Run `/link <your roster name>` once first."
    );
  }

  const code = interaction.options.getString("code", true).trim();
  if (!/^\d{4}$/.test(code)) {
    return interaction.editReply(
      "That's not a 4-digit team number — check the big number on the display site and try again."
    );
  }
  if (!codes.current()) {
    return interaction.editReply(
      "Sign-ins aren't open yet — the display hasn't picked a team code. Try again in a minute."
    );
  }
  if (!codes.isValid(code)) {
    return interaction.editReply(
      "That's not the current team number — the display changes every 60 seconds, so re-read it and try again."
    );
  }

  const result = await attendance.signIn(linkedName, code);
  if (!result || result.ok !== true) {
    if (result && result.already) {
      return interaction.editReply("You're already signed in for today.");
    }
    return interaction.editReply(
      `Sign-in failed: ${(result && result.error) || "unknown error — ask a mentor."}`
    );
  }

  const name = result.name || linkedName;
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
  return missing;
}

function buildCommands() {
  return [
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
          .setDescription("The 4-digit team number currently shown on the display site.")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show which roster name you're linked to."),
  ].map((cmd) => cmd.toJSON());
}

async function main() {
  loadEnvFile();

  const webOnly = String(process.env.WEB_ONLY || "").trim() === "1";
  const missing = webOnly ? [] : requiredEnv();
  if (missing.length > 0) {
    console.error(`[startup] Missing required environment variables: ${missing.join(", ")}`);
    console.error("Set them as Replit Secrets or in bot/.env (see bot/.env.example), then restart.");
    process.exit(1);
  }

  if (!process.env.TBA_AUTH_KEY) {
    console.warn(
      "[startup] TBA_AUTH_KEY is not set — team validation is disabled. " +
        "Sign-ins only work while a cached team exists (degraded mode)."
    );
  }

  try {
    const members = roster.load();
    console.log(`[startup] Roster loaded — ${members.length} members.`);
  } catch (err) {
    console.error("[startup] Roster not readable yet:", err.message);
  }

  await server.start();
  codes.start();

  if (webOnly) {
    console.log("[startup] WEB_ONLY=1 — serving the API only (no Discord login).");
    return;
  }

  const commands = buildCommands();
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

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
