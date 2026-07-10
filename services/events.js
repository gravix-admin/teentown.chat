const clients = new Map();
let ioServer = null;

function setSocketServer(io) {
  ioServer = io;
}

function addClient(userId, res) {
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (_error) {
      removeClient(res);
    }
  }, 25000);
  clients.set(res, { userId, heartbeat });
  res.write("event: ready\ndata: true\n\n");
  res.on("error", () => removeClient(res));
}

function removeClient(res) {
  const meta = clients.get(res);
  if (meta?.heartbeat) clearInterval(meta.heartbeat);
  clients.delete(res);
}

function send(res, event, payload) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch (_error) {
    removeClient(res);
  }
}

function broadcast(event, payload, filter = null) {
  for (const [res, meta] of clients.entries()) {
    if (!filter || filter(meta)) send(res, event, payload);
  }
  if (!ioServer) return;
  if (!filter) {
    ioServer.emit(event, payload);
    return;
  }
  for (const socket of ioServer.sockets.sockets.values()) {
    const meta = { userId: socket.user?.id };
    if (filter(meta)) socket.emit(event, payload);
  }
}

function notifyUser(userId, event, payload) {
  broadcast(event, payload, (meta) => Number(meta.userId) === Number(userId));
}

module.exports = { addClient, removeClient, broadcast, notifyUser, setSocketServer };
