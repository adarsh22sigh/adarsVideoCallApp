const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidV4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Serve the index.html file when visiting any room
app.get("/", (req, res) => {
  res.redirect(uuidV4());  // This redirects to a random room
});

// Serve the room when it's visited via roomId
app.get("/:room", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Handling Socket.IO connections
io.on("connection", (socket) => {
  console.log(`New user connected: ${socket.id}`);

  // Join a room when the user is added to it
  socket.on("join-room", (roomId, userId) => {
    console.log(`User ${userId} joined room ${roomId}`);
    socket.join(roomId);

    // Notify others in the room about this new user
    socket.to(roomId).emit("user-connected", userId);

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`User ${userId} disconnected`);
      socket.to(roomId).emit("user-disconnected", userId);
    });
  });

  // Notify all other users when the call has been started
  socket.on("start-call", (roomId, userId) => {
    console.log(`Call started by ${userId} in room ${roomId}`);
    socket.to(roomId).emit("call-incoming", userId);
  });

  // Handle when user answers the incoming call
  socket.on("answer-call", (roomId, userId) => {
    console.log(`User ${userId} accepted the call in room ${roomId}`);
    socket.to(roomId).emit("call-accepted", userId);
  });
});

server.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
