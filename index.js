// Server: index.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
// import User from "./models/User.js";
import Message from "./models/Message.js";
import { authMiddleware } from "./middleware/auth.js";
import User from "./models/User.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI);

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// Authentication routes
app.post("/api/register", async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      password: hashedPassword,
      role: role || "user",
    });

    await user.save();
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Protected routes
app.get("/api/messages", authMiddleware, async (req, res) => {
  try {
    const { role } = req.user;
    let messages;

    if (role === "admin") {
      messages = await Message.find().populate("sender", "username");
    } else {
      messages = await Message.find({ room: req.query.room }).populate(
        "sender",
        "username"
      );
    }

    res.json(messages);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Welcome To The Server!');
})

// Socket.IO middleware for authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication required"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.user.username);

  socket.on("join_room", (room) => {
    socket.join(room);
    console.log(`User ${socket.user.username} joined room ${room}`);
  });

  socket.on("message", async (data) => {
    const message = new Message({
      sender: socket.user.userId,
      content: data.message,
      room: data.room,
    });

    await message.save();

    const populatedMessage = await Message.findById(message._id).populate(
      "sender",
      "username"
    );

    io.to(data.room).emit("message", {
      _id: populatedMessage._id,
      content: populatedMessage.content,
      sender: populatedMessage.sender,
      timestamp: populatedMessage.timestamp,
      room: populatedMessage.room,
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.user.username);
  });
});

server.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
