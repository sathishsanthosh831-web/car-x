const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Car Chase Game Server Running!');
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function broadcast(room, data, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'CREATE_ROOM': {
          const roomId = generateRoomId();
          playerId = 'player1';
          const room = {
            id: roomId,
            players: [{ id: 'player1', ws, role: 'human', ready: false }],
            gameStarted: false,
            checkpoints: [],
          };
          rooms.set(roomId, room);
          currentRoom = room;
          ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomId, playerId: 'player1', role: 'human' }));
          break;
        }

        case 'JOIN_ROOM': {
          const room = rooms.get(data.roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found!' }));
            return;
          }
          if (room.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full!' }));
            return;
          }
          playerId = 'player2';
          room.players.push({ id: 'player2', ws, role: 'police', ready: false });
          currentRoom = room;
          ws.send(JSON.stringify({ type: 'ROOM_JOINED', roomId: data.roomId, playerId: 'player2', role: 'police' }));
          broadcast(room, { type: 'PLAYER_JOINED', playerId: 'player2' }, ws);
          break;
        }

        case 'PLAYER_READY': {
          if (!currentRoom) return;
          const player = currentRoom.players.find(p => p.id === playerId);
          if (player) player.ready = true;
          broadcast(currentRoom, { type: 'PLAYER_READY', playerId }, ws);
          if (currentRoom.players.length === 2 && currentRoom.players.every(p => p.ready)) {
            currentRoom.gameStarted = true;
            const startData = { type: 'GAME_START' };
            currentRoom.players.forEach(p => p.ws.send(JSON.stringify(startData)));
          }
          break;
        }

        case 'GAME_STATE': {
          if (!currentRoom) return;
          broadcast(currentRoom, { type: 'GAME_STATE', playerId, state: data.state }, ws);
          break;
        }

        case 'COLLISION': {
          if (!currentRoom) return;
          broadcast(currentRoom, { type: 'COLLISION', data: data.data });
          break;
        }

        case 'CHECKPOINT': {
          if (!currentRoom) return;
          broadcast(currentRoom, { type: 'CHECKPOINT', playerId, checkpointId: data.checkpointId });
          break;
        }

        case 'GAME_OVER': {
          if (!currentRoom) return;
          currentRoom.players.forEach(p => p.ws.send(JSON.stringify({ type: 'GAME_OVER', winner: data.winner, reason: data.reason })));
          currentRoom.gameStarted = false;
          currentRoom.players.forEach(p => p.ready = false);
          break;
        }

        case 'CHAT': {
          if (!currentRoom) return;
          broadcast(currentRoom, { type: 'CHAT', playerId, message: data.message }, ws);
          break;
        }

        case 'WEBRTC_OFFER':
        case 'WEBRTC_ANSWER':
        case 'WEBRTC_ICE': {
          if (!currentRoom) return;
          broadcast(currentRoom, { ...data, fromId: playerId }, ws);
          break;
        }
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.players = currentRoom.players.filter(p => p.id !== playerId);
      broadcast(currentRoom, { type: 'PLAYER_DISCONNECTED', playerId });
      if (currentRoom.players.length === 0) {
        rooms.delete(currentRoom.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
