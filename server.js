const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidV4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Generate a unique room ID
app.get("/", (req, res) => {
  res.redirect(uuidV4());
});

// Serve the room
app.get("/:room", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

io.on("connection", (socket) => {
  // Listen for user joining a room
  socket.on("join-room", (roomId, userId) => {
    console.log(`User ${userId} joined room ${roomId}`);
    socket.join(roomId);
    // Notify other users about this connection
    socket.to(roomId).emit("user-connected", userId);

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`User ${userId} disconnected`);
      socket.to(roomId).emit("user-disconnected", userId);
    });
  });

  // Listen for start-call and broadcast to other users that a call is incoming
  socket.on("start-call", (roomId, userId) => {
    console.log(`Call started by ${userId} in room ${roomId}`);
    socket.to(roomId).emit("call-incoming", userId);
  });
});
server.listen(3000, () => {
  console.log("Server is running on https://6797c0d1bc90030d26398a24--guileless-druid-2e449f.netlify.app:3000");
});
