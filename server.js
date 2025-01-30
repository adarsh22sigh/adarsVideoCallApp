 const express = require('express');
const { createWorker } = require('mediasoup');
const socketIo = require('socket.io');

const app = express();
app.use(express.static('public'));

const io = socketIo.listen(3000, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const workers = [];
let workerIdx = 0;

(async () => {
  const worker = await createWorker();
  workers.push(worker);
})();

const rooms = new Map();

io.on('connection', async (socket) => {
  socket.on('join', async ({ roomId, peerId }, callback) => {
    if (!rooms.has(roomId)) {
      const worker = workers[workerIdx % workers.length];
      workerIdx++;
      
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

  socket.on('getProducers', async (callback) => {
    const room = rooms.get(socket.roomId);
    const producers = [];
    room.peers.forEach(peer => {
      if (peer.producers) {
        producers.push(...peer.producers.values());
      }
    });
    callback(producers);
  });

  socket.on('createTransport', async ({ consuming }, callback) => {
    const room = rooms.get(socket.roomId);
    const transport = await (consuming 
      ? room.router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true
        })
      : room.router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true
        }));

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') transport.close();
    });

    if (!room.peers.get(socket.peerId).transports) {
      room.peers.get(socket.peerId).transports = new Map();
    }
    room.peers.get(socket.peerId).transports.set(transport.id, transport);

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    const room = rooms.get(socket.roomId);
    const transport = room.peers.get(socket.peerId).transports.get(transportId);
    await transport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    const room = rooms.get(socket.roomId);
    const transport = room.peers.get(socket.peerId).transports.get(transportId);
    const producer = await transport.produce({ kind, rtpParameters });
    
    if (!room.peers.get(socket.peerId).producers) {
      room.peers.get(socket.peerId).producers = new Map();
    }
    room.peers.get(socket.peerId).producers.set(producer.id, producer);
    
    socket.broadcast.to(socket.roomId).emit('newProducer', {
      producerId: producer.id,
      peerId: socket.peerId
    });

    callback(producer.id);
  });

  socket.on('consume', async ({ transportId, producerId }, callback) => {
    const room = rooms.get(socket.roomId);
    const consumerTransport = room.peers.get(socket.peerId).transports.get(transportId);
    const producer = Array.from(room.peers.values())
      .find(peer => peer.producers && peer.producers.has(producerId))
      ?.producers.get(producerId);

    if (!producer) return;

    const consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: false
    });

    if (!room.peers.get(socket.peerId).consumers) {
      room.peers.get(socket.peerId).consumers = new Map();
    }
    room.peers.get(socket.peerId).consumers.set(consumer.id, consumer);

    callback({
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });

    consumer.on('transportclose', () => {
      consumer.close();
    });
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
