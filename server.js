const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let queue = [];
const userRooms = new Map();

function joinQueue(user) {
    if (!queue.some(u => u.id === user.id)) {
        queue.push(user);
        console.log(`User ${user.id} joined queue. Queue size: ${queue.length}`);
        matchUsers();
    }
}

function matchUsers() {
    while (queue.length >= 2) {
        const user1 = queue.shift();
        const user2 = queue.shift();

        const roomId = `room-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        user1.join(roomId);
        user2.join(roomId);

        userRooms.set(user1.id, roomId);
        userRooms.set(user2.id, roomId);

        user1.emit('match_found', { roomId, peerId: user2.id, initiator: true });
        user2.emit('match_found', { roomId, peerId: user1.id, initiator: false });
        
        console.log(`Match réussi : ${user1.id} avec ${user2.id}`);
    }
}

function leaveQueue(user) {
    queue = queue.filter(u => u.id !== user.id);
}

function disconnectUser(user) {
    leaveQueue(user);
    const roomId = userRooms.get(user.id);
    if (roomId) {
        user.to(roomId).emit('peer_disconnected');
        user.leave(roomId);
        userRooms.delete(user.id);
    }
}

io.on('connection', (socket) => {
    socket.on('join_queue', () => joinQueue(socket));
    socket.on('leave_queue', () => leaveQueue(socket));
    socket.on('leave_room', () => disconnectUser(socket));
    socket.on('disconnect', () => disconnectUser(socket));

    // Signaux WebRTC pour traverser les pare-feux
    socket.on('webrtc_offer', (data) => socket.to(data.to).emit('webrtc_offer', { from: socket.id, offer: data.offer }));
    socket.on('webrtc_answer', (data) => socket.to(data.to).emit('webrtc_answer', { from: socket.id, answer: data.answer }));
    socket.on('webrtc_ice_candidate', (data) => socket.to(data.to).emit('webrtc_ice_candidate', { from: socket.id, candidate: data.candidate }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Matchmaking et WebRTC démarré sur le port ${PORT}`);
});
