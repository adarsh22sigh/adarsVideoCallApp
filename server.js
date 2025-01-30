 const mediasoup = require('mediasoup');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const mediaCodecs = [
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
];

let worker;
let router;
const rooms = new Map();

async function initialize() {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs });
}

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const message = JSON.parse(data);
    
    switch (message.type) {
      case 'getRouterCapabilities':
        handleRouterCapabilities(ws, message);
        break;
      case 'createTransport':
        handleCreateTransport(ws, message);
        break;
      case 'connectTransport':
        handleConnectTransport(ws, message);
        break;
      case 'createProducer':
        handleCreateProducer(ws, message);
        break;
    }
  });
});

async function handleRouterCapabilities(ws, message) {
  sendResponse(ws, message.requestId, {
    rtpCapabilities: router.rtpCapabilities
  });
}

async function handleCreateTransport(ws, message) {
  const { direction, roomId } = message.data;
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: 'YOUR_SERVER_IP' }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  if (!rooms.has(roomId)) {
    rooms.set(roomId, { transports: [], producers: [] });
  }
  const room = rooms.get(roomId);
  room.transports.push(transport);

  sendResponse(ws, message.requestId, {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });
}

async function handleConnectTransport(ws, message) {
  const { transportId, dtlsParameters } = message.data;
  const transport = router.transports.get(transportId);
  await transport.connect({ dtlsParameters });
  sendResponse(ws, message.requestId, { connected: true });
}

async function handleCreateProducer(ws, message) {
  const { transportId, kind, rtpParameters, roomId } = message.data;
  const transport = router.transports.get(transportId);
  const producer = await transport.produce({ kind, rtpParameters });
  
  const room = rooms.get(roomId);
  room.producers.push(producer);
  
  sendResponse(ws, message.requestId, { id: producer.id });
}

function sendResponse(ws, requestId, data) {
  ws.send(JSON.stringify({
    type: 'response',
    requestId,
    data
  }));
}

initialize().then(() => {
  server.listen(3000, () => {
    console.log('Server running on port 3000');
  });
});
