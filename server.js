 const express = require('express');
const { createWorker } = require('mediasoup');
const socketIo = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const mediasoupWorkers = [];
const rooms = new Map();

(async () => {
  const worker = await createWorker();
  mediasoupWorkers.push(worker);
})();

io.on('connection', (socket) => {
  socket.on('joinRoom', async ({ roomId, peerId }, callback) => {
    if (!rooms.has(roomId)) {
      const worker = mediasoupWorkers[0];
      const router = await worker.createRouter({
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: {
              'x-google-start-bitrate': 1000
            }
          }
        ]
      });
      
      rooms.set(roomId, {
        router,
        peers: new Map()
      });
    }

    const room = rooms.get(roomId);
    room.peers.set(peerId, { socket });
    socket.peerId = peerId;
    socket.roomId = roomId;

    callback({
      routerRtpCapabilities: room.router.rtpCapabilities
    });
  });

  socket.on('createTransport', async ({ consuming, peerId }, callback) => {
    const room = rooms.get(socket.roomId);
    const transport = consuming 
      ? await room.router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true
        })
      : await room.router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true
        });

    if (!room.peers.get(peerId).transports) {
      room.peers.get(peerId).transports = new Map();
    }
    room.peers.get(peerId).transports.set(transport.id, transport);

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters, peerId }, callback) => {
    const room = rooms.get(socket.roomId);
    const transport = room.peers.get(peerId).transports.get(transportId);
    await transport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters, peerId }, callback) => {
    const room = rooms.get(socket.roomId);
    const transport = room.peers.get(peerId).transports.get(transportId);
    const producer = await transport.produce({ kind, rtpParameters });

    if (!room.peers.get(peerId).producers) {
      room.peers.get(peerId).producers = new Map();
    }
    room.peers.get(peerId).producers.set(producer.id, producer);

    socket.to(roomId).emit('newProducer', {
      producerId: producer.id,
      peerId: peerId
    });

    callback({ id: producer.id });
  });

  socket.on('consume', async ({ producerId, peerId }, callback) => {
    const room = rooms.get(socket.roomId);
    const consumerTransport = room.peers.get(peerId).transports.values().next().value;
    const producer = Array.from(room.peers.values())
      .find(p => p.producers && p.producers.has(producerId))
      ?.producers.get(producerId);

    if (!producer) return callback({ error: 'Producer not found' });

    const consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: false
    });

    callback({
      consumer: {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        track: consumer.track
      }
    });
  });

  socket.on('leaveRoom', ({ roomId, peerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (peer) {
      peer.transports?.forEach(t => t.close());
      peer.producers?.forEach(p => p.close());
      room.peers.delete(peerId);
    }

    if (room.peers.size === 0) {
      room.router.close();
      rooms.delete(roomId);
    }
  });

  socket.on('disconnect', () => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;

    room.peers.delete(socket.peerId);
    if (room.peers.size === 0) {
      room.router.close();
      rooms.delete(socket.roomId);
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
