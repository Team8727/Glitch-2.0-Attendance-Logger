"use strict";

const MEETING_TZ = process.env.TZ || "America/New_York";
const MEETING_START = "15:30";
const MEETING_END = "17:30";
const MEETINGS_END_DATE = process.env.MEETINGS_END_DATE || "2027-01-09";

const NO_SCHOOL_DATES = new Set([
  "2026-11-26",
  "2026-11-27",
  "2026-12-21",
  "2026-12-22",
  "2026-12-23",
  "2026-12-24",
  "2026-12-25",
  "2026-12-28",
  "2026-12-29",
  "2026-12-30",
  "2026-12-31",
  "2027-01-01",
  "2027-01-11",
  "2027-01-12",
  "2027-01-13",
  "2027-01-14",
  "2027-01-15",
  "2027-01-18",
  "2027-01-19",
]);

function dateStringInTz(date = new Date(), timeZone = MEETING_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function meetingStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MEETING_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const minutes = hour * 60 + minute;
  const dateStr = dateStringInTz(now);
  const isMeetingDay = weekday === "Tue" || weekday === "Thu";
  const inSession =
    isMeetingDay &&
    !NO_SCHOOL_DATES.has(dateStr) &&
    dateStr <= MEETINGS_END_DATE &&
    minutes >= 15 * 60 + 30 &&
    minutes <= 17 * 60 + 30;
  return { inSession, dateStr, weekday, minutes };
}

module.exports = {
  MEETING_TZ,
  MEETING_START,
  MEETING_END,
  MEETINGS_END_DATE,
  NO_SCHOOL_DATES,
  dateStringInTz,
  meetingStatus,
};
