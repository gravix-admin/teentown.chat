const bcrypt = require("bcrypt");
const pool = require("../database");
const { broadcast } = require("./events");

const DEFAULT_INTERVAL_MINUTES = 5;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;
const BOT_NAME = "Intruder";
const BOT_AVATAR = "/assets/intruder-bot.png";
const INTRUDER_PREFIX = "::intruder:";

let loopStarted = false;
let tickRunning = false;
let tickTimer = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeInterval(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_INTERVAL_MINUTES;
  const roundedToFive = Math.round(numeric / 5) * 5;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, roundedToFive || DEFAULT_INTERVAL_MINUTES));
}

function randomPoints() {
  return Math.floor(Math.random() * 91) + 10;
}

function mysqlUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseMysqlUtc(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds()
    ));
  }
  const normalized = String(value).replace(" ", "T");
  return new Date(`${normalized.endsWith("Z") ? normalized : `${normalized}Z`}`);
}

function toIso(value) {
  const date = parseMysqlUtc(value);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function nextAlignedDate(intervalMinutes, from = new Date()) {
  const interval = sanitizeInterval(intervalMinutes);
  const next = new Date(from);
  const currentMinutes = next.getUTCMinutes();
  const remainder = currentMinutes % interval;
  const addMinutes = remainder === 0 ? interval : interval - remainder;
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(currentMinutes + addMinutes);
  return next;
}

function intruderBody(payload) {
  return `${INTRUDER_PREFIX}${JSON.stringify(payload)}`;
}

async function ensureBotUser() {
  const [rows] = await pool.query("SELECT id FROM users WHERE LOWER(username) = 'intruder' LIMIT 1");
  if (rows.length) {
    await pool.query("UPDATE users SET display_name = ?, avatar_url = ?, bio = ? WHERE id = ?", [BOT_NAME, BOT_AVATAR, "Intruder game bot.", rows[0].id]);
    return rows[0].id;
  }

  const hash = await bcrypt.hash(`intruder-${Date.now()}`, 10);
  const email = `intruder-${Date.now()}@teens-town.local`;
  const [result] = await pool.query(
    `INSERT INTO users
     (username, email, password_hash, dob, age, gender, rank_name, display_name, avatar_url, bio, about_me, xp, gold, diamonds, ip_address, country, frame, theme, chat_background)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [BOT_NAME, email, hash, "2007-01-01", 19, "other", "user", BOT_NAME, BOT_AVATAR, "Intruder game bot.", "Drops surprise point hunts in chat rooms.", 0, 0, 0, "system", "Teen Chat Town", "clean", "dark", "moonlake"]
  );
  return result.insertId;
}

async function ensureSettings() {
  const botUserId = await ensureBotUser();
  await pool.query(
    "INSERT IGNORE INTO intruder_settings (id, enabled, interval_minutes, bot_user_id, bot_name, bot_avatar_url) VALUES (1, 0, ?, ?, ?, ?)",
    [DEFAULT_INTERVAL_MINUTES, botUserId, BOT_NAME, BOT_AVATAR]
  );
  await pool.query(
    "UPDATE intruder_settings SET bot_user_id = ?, bot_name = ?, bot_avatar_url = ? WHERE id = 1",
    [botUserId, BOT_NAME, BOT_AVATAR]
  );
}

async function getSettings() {
  const [rows] = await pool.query("SELECT * FROM intruder_settings WHERE id = 1");
  if (rows.length) return rows[0];
  await ensureSettings();
  const [freshRows] = await pool.query("SELECT * FROM intruder_settings WHERE id = 1");
  return freshRows[0];
}

async function getMainRoom() {
  const [rows] = await pool.query(
    `SELECT id FROM rooms
     ORDER BY is_pinned DESC, FIELD(name, 'Town Square', 'Main Room') DESC, id ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function messageById(messageId) {
  const [rows] = await pool.query(
    `SELECT m.*, u.username, u.rank_name, u.profile_title, u.avatar_url, u.username_color, u.text_color, u.bubble_style
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = ?`,
    [messageId]
  );
  return rows[0] || null;
}

async function sendBotMessage(roomId, payload) {
  const settings = await getSettings();
  const botUserId = settings.bot_user_id || await ensureBotUser();
  const [result] = await pool.query(
    "INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)",
    [roomId, botUserId, intruderBody(payload)]
  );
  const message = await messageById(result.insertId);
  if (message) broadcast("message", message);
  return message;
}

async function resolveExpiredRounds() {
  const [rounds] = await pool.query(
    "SELECT * FROM intruder_rounds WHERE status = 'active' AND ends_at <= UTC_TIMESTAMP() ORDER BY spawned_at ASC LIMIT 10"
  );

  for (const round of rounds) {
    const [result] = await pool.query(
      "UPDATE intruder_rounds SET status = 'survived', resolved_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active'",
      [round.id]
    );
    if (result.affectedRows) {
      await sendBotMessage(round.room_id, { type: "survived" });
    }
  }
}

async function spawnIntruderRound(settings) {
  const [[active]] = await pool.query("SELECT id FROM intruder_rounds WHERE status = 'active' AND ends_at > UTC_TIMESTAMP() LIMIT 1");
  if (active) return;

  const room = await getMainRoom();
  if (!room) return;

  const points = randomPoints();
  const [result] = await pool.query(
    `INSERT INTO intruder_rounds (room_id, points, status, spawned_at, ends_at)
     VALUES (?, ?, 'active', UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE))`,
    [room.id, points]
  );
  const message = await sendBotMessage(room.id, { type: "alert", points });
  if (message?.id) {
    await pool.query("UPDATE intruder_rounds SET message_id = ? WHERE id = ?", [message.id, result.insertId]);
  }

  const nextSpawn = nextAlignedDate(settings.interval_minutes);
  await pool.query("UPDATE intruder_settings SET next_spawn_at = ? WHERE id = 1", [mysqlUtc(nextSpawn)]);
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await resolveExpiredRounds();
    const settings = await getSettings();
    if (!settings.enabled) return;

    if (!settings.next_spawn_at) {
      const nextSpawn = nextAlignedDate(settings.interval_minutes);
      await pool.query("UPDATE intruder_settings SET next_spawn_at = ? WHERE id = 1", [mysqlUtc(nextSpawn)]);
      return;
    }

    const nextSpawn = parseMysqlUtc(settings.next_spawn_at);
    if (nextSpawn && nextSpawn.getTime() <= Date.now()) {
      await spawnIntruderRound(settings);
    }
  } finally {
    tickRunning = false;
  }
}

function scheduleTick(delay = 5000) {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(async () => {
    try {
      await tick();
    } catch (error) {
      console.error("[intruder] loop retrying after error:", error.message);
      await wait(1000).catch(() => {});
    } finally {
      scheduleTick(5000);
    }
  }, delay);
  tickTimer.unref?.();
}

function startIntruderLoop() {
  if (loopStarted) return;
  loopStarted = true;
  scheduleTick(1500);
}

async function updateIntruderSettings({ enabled, intervalMinutes }) {
  await ensureSettings();
  const interval = sanitizeInterval(intervalMinutes);
  if (enabled) {
    const nextSpawn = nextAlignedDate(interval);
    await pool.query(
      "UPDATE intruder_settings SET enabled = 1, interval_minutes = ?, next_spawn_at = ? WHERE id = 1",
      [interval, mysqlUtc(nextSpawn)]
    );
  } else {
    await pool.query("UPDATE intruder_settings SET enabled = 0, interval_minutes = ?, next_spawn_at = NULL WHERE id = 1", [interval]);
  }
  broadcast("intruder-settings-updated", { enabled: Boolean(enabled), intervalMinutes: interval });
  return getIntruderState();
}

async function resetIntruderScores() {
  await pool.query("DELETE FROM intruder_scores");
  broadcast("intruder-score-updated", { reset: true });
  return getIntruderState();
}

async function getIntruderState() {
  const settings = await getSettings();
  const [activeRows] = await pool.query(
    "SELECT * FROM intruder_rounds WHERE status = 'active' AND ends_at > UTC_TIMESTAMP() ORDER BY spawned_at DESC LIMIT 1"
  );
  const [scores] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.rank_name, u.profile_title,
            s.points AS intruder_points, s.shots AS intruder_shots
     FROM intruder_scores s
     JOIN users u ON u.id = s.user_id
     ORDER BY s.points DESC, s.shots DESC, u.username ASC
     LIMIT 10`
  );

  return {
    intruder: {
      enabled: Boolean(settings.enabled),
      intervalMinutes: sanitizeInterval(settings.interval_minutes),
      nextSpawnAt: toIso(settings.next_spawn_at),
      botName: settings.bot_name || BOT_NAME,
      botAvatarUrl: settings.bot_avatar_url || BOT_AVATAR,
      activeRound: activeRows[0] ? {
        id: activeRows[0].id,
        roomId: activeRows[0].room_id,
        points: activeRows[0].points,
        spawnedAt: toIso(activeRows[0].spawned_at),
        endsAt: toIso(activeRows[0].ends_at),
      } : null,
      scores,
    },
  };
}

async function handlePossibleShot(message, shooter) {
  const body = String(message?.body || "");
  if (!/shoot/i.test(body)) return false;
  if (!message?.room_id || !shooter?.id) return false;

  const [rounds] = await pool.query(
    "SELECT * FROM intruder_rounds WHERE room_id = ? AND status = 'active' AND ends_at > UTC_TIMESTAMP() ORDER BY spawned_at DESC LIMIT 1",
    [message.room_id]
  );
  const round = rounds[0];
  if (!round) return false;

  const [claim] = await pool.query(
    "UPDATE intruder_rounds SET status = 'shot', shooter_id = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active'",
    [shooter.id, round.id]
  );
  if (!claim.affectedRows) return false;

  await pool.query(
    `INSERT INTO intruder_scores (user_id, points, shots)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE points = points + ?, shots = shots + 1`,
    [shooter.id, round.points, round.points]
  );
  const [[score]] = await pool.query("SELECT points, shots FROM intruder_scores WHERE user_id = ?", [shooter.id]);
  await sendBotMessage(message.room_id, {
    type: "shot",
    username: shooter.username,
    points: round.points,
    total: score?.points || round.points,
    shots: score?.shots || 1,
  });
  broadcast("intruder-score-updated", { userId: shooter.id });
  return true;
}

module.exports = {
  INTRUDER_PREFIX,
  getIntruderState,
  handlePossibleShot,
  resetIntruderScores,
  startIntruderLoop,
  updateIntruderSettings,
};
