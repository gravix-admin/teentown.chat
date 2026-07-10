require("dotenv").config({ quiet: true });

const mysql = require("mysql2/promise");

const RETRY_DELAYS_MS = [800, 1800, 3500, 6000];
const transientCodes = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
  "PROTOCOL_PACKETS_OUT_OF_ORDER",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);

const transientErrnos = new Set([1053, 1205, 1213, 2002, 2003, 2006, 2013]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sslOptions() {
  return process.env.DB_SSL === "true"
    ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
        ca: process.env.DB_CA_CERT ? process.env.DB_CA_CERT.replace(/\\n/g, "\n") : undefined,
      }
    : undefined;
}

function poolConfig() {
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    ssl: sslOptions(),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
}

let currentPool;

function createPool() {
  currentPool = mysql.createPool(poolConfig());
  return currentPool;
}

function getPool() {
  return currentPool || createPool();
}

async function resetPool() {
  const pool = currentPool;
  currentPool = null;
  if (pool) {
    await pool.end().catch(() => {});
  }
}

function isTransientDatabaseError(error) {
  return Boolean(
    error
      && (transientCodes.has(error.code)
        || transientErrnos.has(error.errno)
        || error.fatal
        || /closed|lost|timeout|shutdown|restart|getaddrinfo/i.test(error.message || ""))
  );
}

function logRetry(error, attempt, maxAttempts) {
  const code = error?.code || error?.errno || "DB_ERROR";
  console.error(`[database] ${code}: ${error?.message || "Database query failed"}; retry ${attempt}/${maxAttempts}`);
}

async function withRetry(operation, { retries = RETRY_DELAYS_MS.length } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(getPool());
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === retries) break;
      logRetry(error, attempt + 1, retries);
      await resetPool();
      await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    }
  }
  throw lastError;
}

module.exports = {
  query: (sql, params) => withRetry((pool) => pool.query(sql, params)),
  execute: (sql, params) => withRetry((pool) => pool.execute(sql, params)),
  getConnection: () => withRetry((pool) => pool.getConnection(), { retries: 2 }),
  end: async () => {
    await resetPool();
  },
  isTransientDatabaseError,
};
