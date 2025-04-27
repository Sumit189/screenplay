// Socket.IO serverless function for Vercel
const { Server } = require('socket.io');

// Create a rooms map (note: this will reset when the function is redeployed or scaled)
const rooms = new Map();
// Store client IPs
const clientIPs = new Map();

// Check if an IP address is a local network IP (private range)
const isLocalIP = (ip) => {
  // Handle localhost
  if (ip === '127.0.0.1' || ip === 'localhost') return true;
  
  // Private IP ranges
  return (
    ip.startsWith('10.') || 
    ip.startsWith('192.168.') || 
    ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) !== null
  );
};

// Get the local subnet prefix (e.g., "192.168.1.")
const getLocalSubnetPrefix = (ip) => {
  if (!isLocalIP(ip)) return null;
  
  // For IP like 192.168.1.xxx, return 192.168.1.
  const lastDotIndex = ip.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    return ip.substring(0, lastDotIndex + 1);
  }
  return null;
};

// Check if two IPs are on the same local network
const areOnSameLocalNetwork = (ip1, ip2) => {
  if (!isLocalIP(ip1) || !isLocalIP(ip2)) return false;
  
  const prefix1 = getLocalSubnetPrefix(ip1);
  const prefix2 = getLocalSubnetPrefix(ip2);
  
  return prefix1 !== null && prefix1 === prefix2;
};

// Get client IP from request
const getClientIP = (req) => {
  let ip;
  
  if (req.headers['x-forwarded-for']) {
    ip = req.headers['x-forwarded-for'].split(',')[0].trim();
  } else if (req.headers['x-real-ip']) {
    ip = req.headers['x-real-ip'];
  } else if (req.socket && req.socket.remoteAddress) {
    ip = req.socket.remoteAddress;
  } else {
    ip = '127.0.0.1';
  }
  
  // Clean the IP (remove IPv6 prefix if present)
  if (ip.includes('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  
  return ip;
};

// Log room state for debugging
const logRoomState = (roomId) => {
  const room = rooms.get(roomId);
  if (room) {
    console.log(`Room state for ${roomId}:`);
    console.log(`- Host: ${room.host} (IP: ${clientIPs.get(room.host) || 'unknown'})`);
    console.log(`- Viewers: ${Array.from(room.viewers).join(', ') || 'none'}`);
    console.log(`- Is sharing: ${room.isSharing}`);
  } else {
    console.log(`Room ${roomId} does not exist`);
  }
};

let io;

module.exports = (req, res) => {
  // Only allow websocket connections
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/plain');
    res.statusCode = 200;
    res.end('WebSocket server is running');
    return;
  }

  // Get client IP
  const clientIP = getClientIP(req);
  
  // Check if socket.io server was already initialized
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server');
    
    // Create socket.io server
    io = new Server(res.socket.server, {
      path: '/socket.io/',
      addTrailingSlash: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      maxHttpBufferSize: 1e8 // 100 MB
    });

    // Save io instance
    res.socket.server.io = io;

    // Socket.IO event handlers
    io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}, IP: ${clientIP}`);
      clientIPs.set(socket.id, clientIP);

      // Register client IP
      socket.on('registerIP', (ip) => {
        console.log(`Registering IP for ${socket.id}: ${ip}`);
        clientIPs.set(socket.id, ip);
      });

      // Create a room
      socket.on('createRoom', (roomId) => {
        rooms.set(roomId, { 
          host: socket.id, 
          hostIP: clientIPs.get(socket.id),
          viewers: new Set(),
          isSharing: false
        });
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        console.log(`Room created: ${roomId} by host: ${socket.id}, IP: ${clientIPs.get(socket.id)}`);
        logRoomState(roomId);
      });

      // Join a room
      socket.on('joinRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
          const viewerIP = clientIPs.get(socket.id);
          const hostIP = clientIPs.get(room.host);
          
          // Check if the viewer is on the same local network as the host
          const sameNetwork = areOnSameLocalNetwork(hostIP, viewerIP);
          
          if (!sameNetwork && isLocalIP(hostIP) && isLocalIP(viewerIP)) {
            console.log(`Network restriction: ${socket.id} (${viewerIP}) cannot join room hosted by ${room.host} (${hostIP})`);
            socket.emit('error', 'You can only join rooms from the same local network');
            return;
          }
          
          room.viewers.add(socket.id);
          socket.join(roomId);
          socket.emit('roomJoined', roomId);
          console.log(`User ${socket.id} joined room: ${roomId}`);
          logRoomState(roomId);
          
          // If host is already sharing, notify the new viewer
          if (room.isSharing) {
            socket.emit('hostIsSharing', { roomId });
            console.log(`Notified viewer ${socket.id} that host is already sharing`);
          }
        } else {
          socket.emit('error', 'Room not found');
          console.log(`Room not found: ${roomId}`);
        }
      });

      // Viewer signals they're ready for WebRTC
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

      // Handle disconnections
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}, IP: ${clientIPs.get(socket.id)}`);
        
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
        
        // Remove client IP
        clientIPs.delete(socket.id);
      });
    });
  }
  
  // Return OK
  res.end('Socket.IO handling request');
}; 