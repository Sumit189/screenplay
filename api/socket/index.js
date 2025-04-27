// Socket.IO serverless function for Vercel
const { Server } = require('socket.io');
const cors = require('cors');

// Get allowed origins from environment variable or use default
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ["https://your-vercel-app.vercel.app"];

const rooms = new Map();

// Log room state for debugging
const logRoomState = (roomId) => {
  const room = rooms.get(roomId);
  if (room) {
    console.log(`Room state for ${roomId}:`);
    console.log(`- Host: ${room.host}`);
    console.log(`- Viewers: ${Array.from(room.viewers).join(', ') || 'none'}`);
    console.log(`- Is sharing: ${room.isSharing}`);
  } else {
    console.log(`Room ${roomId} does not exist`);
  }
};

const ioHandler = (req, res) => {
  if (res.socket.server.io) {
    console.log('Socket is already attached');
    res.end();
    return;
  }

  const io = new Server(res.socket.server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: {
      origin: function(origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["*"]
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e8 // 100 MB
  });
  
  res.socket.server.io = io;

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (roomId) => {
      rooms.set(roomId, { 
        host: socket.id, 
        viewers: new Set(),
        isSharing: false
      });
      socket.join(roomId);
      socket.emit('roomCreated', roomId);
      console.log(`Room created: ${roomId} by host: ${socket.id}`);
      logRoomState(roomId);
    });

    socket.on('joinRoom', (roomId) => {
      const room = rooms.get(roomId);
      if (room) {
        room.viewers.add(socket.id);
        socket.join(roomId);
        socket.emit('roomJoined', roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);
        logRoomState(roomId);
        
        // If host is already sharing, send the status to the new viewer
        if (room.isSharing) {
          socket.emit('hostIsSharing', { roomId });
          console.log(`Notified viewer ${socket.id} that host is already sharing`);
        }
      } else {
        socket.emit('error', 'Room not found');
        console.log(`Room not found: ${roomId}`);
      }
    });

    // Viewer notifies the server they've joined and are ready for WebRTC
    socket.on('viewerJoined', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room && room.host) {
        // Notify the host that a new viewer has joined
        io.to(room.host).emit('newViewer', socket.id);
        console.log(`Notified host ${room.host} of new viewer ${socket.id}`);
        logRoomState(roomId);
      } else {
        console.log(`ViewerJoined event for non-existent room: ${roomId}`);
      }
    });

    // Host starts screen sharing
    socket.on('startScreenShare', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.isSharing = true;
        console.log(`Host started screen sharing in room ${roomId}`);
        logRoomState(roomId);
      }
    });

    // Host stops screen sharing
    socket.on('stopScreenShare', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.isSharing = false;
        io.to(roomId).emit('hostStoppedSharing');
        console.log(`Host stopped screen sharing in room ${roomId}`);
        logRoomState(roomId);
      }
    });

    // WebRTC Signaling: Offer
    socket.on('offer', ({ to, from, offer }) => {
      console.log(`Forwarding offer from ${from} to ${to}`);
      io.to(to).emit('offer', { from, offer });
    });

    // WebRTC Signaling: Answer
    socket.on('answer', ({ to, from, answer }) => {
      console.log(`Forwarding answer from ${from} to ${to}`);
      io.to(to).emit('answer', { from, answer });
    });

    // WebRTC Signaling: ICE Candidate
    socket.on('iceCandidate', ({ to, from, candidate }) => {
      console.log(`Forwarding ICE candidate from ${from} to ${to}`);
      if (to === 'host') {
        // Find the host for the room that this viewer is in
        let hostId = null;
        for (const [roomId, room] of rooms.entries()) {
          if (room.viewers.has(from)) {
            hostId = room.host;
            break;
          }
        }
        
        if (hostId) {
          io.to(hostId).emit('iceCandidate', { from, candidate });
          console.log(`Forwarded ICE candidate to host ${hostId}`);
        } else {
          console.warn(`Could not find host for viewer ${from}`);
        }
      } else {
        io.to(to).emit('iceCandidate', { from, candidate });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      // Find any rooms this user was part of
      rooms.forEach((room, roomId) => {
        if (room.host === socket.id) {
          // If host disconnects, notify all viewers and delete the room
          io.to(roomId).emit('hostDisconnected');
          rooms.delete(roomId);
          console.log(`Host disconnected, room deleted: ${roomId}`);
        } else if (room.viewers.has(socket.id)) {
          // If viewer disconnects, remove them from the room and notify host
          room.viewers.delete(socket.id);
          if (room.host) {
            io.to(room.host).emit('viewerLeft', socket.id);
            console.log(`Viewer left room: ${roomId}. Notified host: ${room.host}`);
            logRoomState(roomId);
          }
        }
      });
    });
  });

  console.log('Socket.io server initialized');
  res.end();
};

// Create an API endpoint for ICE servers
const iceServersHandler = (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  });
};

module.exports = (req, res) => {
  if (req.method === 'GET' && req.url === '/api/ice-servers') {
    return iceServersHandler(req, res);
  }
  
  return ioHandler(req, res);
}; 