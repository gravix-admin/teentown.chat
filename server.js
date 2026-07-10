require("dotenv").config({ quiet: true });

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { initSchema } = require("./services/schema");
const database = require("./database");
const { attachUser } = require("./middleware/auth");
const { setSocketServer, broadcast } = require("./services/events");
const { startIntruderLoop } = require("./services/intruderService");

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const socialRoutes = require("./routes/social");
const adminRoutes = require("./routes/admin");

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket"],
  allowUpgrades: false,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6,
});

setSocketServer(io);

let compression = null;
try {
  compression = require("compression");
} catch (_error) {
  if (isProduction) console.warn("compression package is not installed; responses will not be gzip compressed.");
}

function staticOptions(maxAge) {
  return {
    etag: true,
    lastModified: true,
    maxAge,
    immutable: maxAge !== "0",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.use(cors());
if (compression) app.use(compression());
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);
app.use("/uploads", express.static(path.join(__dirname, "uploads"), staticOptions("30d")));
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), staticOptions("30d")));
app.use(express.static(path.join(__dirname, "public"), staticOptions(isProduction ? "1h" : "0")));

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Teens Town Chat" });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const dbError = database.isTransientDatabaseError?.(error);
  res.status(dbError ? 503 : 500).json({
    error: dbError ? "Database is reconnecting. Please try again in a moment." : "Server error.",
  });
});

async function keepSchemaReady() {
  for (;;) {
    try {
      await initSchema();
      console.log("Database schema ready.");
      startIntruderLoop();
      return;
    } catch (error) {
      console.error("Database schema check failed; retrying shortly.");
      console.error(error.message);
      if ((process.env.DB_PASSWORD || "").includes("YOUR_PASSWORD")) {
        console.error("Edit .env and replace DB_PASSWORD=YOUR_PASSWORD with your real MySQL password.");
      }
      await wait(5000);
    }
  }
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled async error:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught error:", error);
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("Login required."));
    const payload = jwt.verify(String(token), process.env.JWT_SECRET);
    const [rows] = await database.query("SELECT * FROM users WHERE id = ?", [payload.id]);
    const user = rows[0];
    if (!user) return next(new Error("Login required."));
    if (user.banned_until && new Date(user.banned_until) > new Date()) return next(new Error("This account is banned."));
    if (user.kicked_until && new Date(user.kicked_until) > new Date()) return next(new Error("You were temporarily kicked. Please try again later."));
    socket.user = user;
    next();
  } catch (error) {
    console.error("Socket auth failed:", error.message);
    next(new Error(database.isTransientDatabaseError?.(error) ? "Database is reconnecting." : "Login required."));
  }
});

io.on("connection", async (socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.emit("ready", true);
  await database.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [socket.user.id]).catch((error) => {
    console.error("Could not update last_seen for socket connect:", error.message);
  });
  broadcast("users-changed", { userId: socket.user.id });
  socket.on("disconnect", async () => {
    await database.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [socket.user.id]).catch((error) => {
      console.error("Could not update last_seen for socket disconnect:", error.message);
    });
    broadcast("users-changed", { userId: socket.user.id });
  });
});

server.listen(port, () => {
  console.log(`Teens Town Chat running on http://127.0.0.1:${port}`);
});

keepSchemaReady();
