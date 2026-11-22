import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { getHouseBlueprint } from './src/game/houses';
import { generateDailyQuests } from './src/game/quests';
import type {
  CraftUpgrades,
  GnomeColorId,
  HumanAlertState,
  HumanWeapon,
  ItemCategory,
  NetBossGnomeState,
  NetCarState,
  NetPetsState,
  Quest,
  QuestType,
} from './src/types/game';

interface ServerProp {
  id: string;
  name: string;
  category: ItemCategory;
  valueShinies: number;
  valueScrap: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  vx: number;
  vy: number;
  vz: number;
  collected: boolean;
  broken: boolean;
  tipped: boolean;
  heldBy: string | null;
}

interface ServerInsect {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

interface ServerHuman {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  alert: HumanAlertState;
  weapon: HumanWeapon;
  grabState: 'none' | 'carrying' | 'winding_up';
  grabTargetId: string | null;
  aiming: boolean;
  startleTimer: number;
  swipeTimer: number;
}

interface RoomPlayer {
  id: string;
  name: string;
  color: GnomeColorId;
  isHost: boolean;
  ws: WebSocket;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  isCrouching: boolean;
  isClimbing: boolean;
  isGrounded: boolean;
  hasStick: boolean;
  stickSwinging: boolean;
  heldPropId: string | null;
  hp: number;
  isDowned: boolean;
  isGrabbed: boolean;
  dismemberMask: number;
  inCopter: boolean;
  inCarSeat: 0 | 1 | 2;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: GnomeColorId;
  text: string;
  timestamp: number;
  system?: boolean;
}

interface GameRoom {
  code: string;
  name: string;
  isPublic: boolean;
  maxPlayers: number;
  hostId: string;
  day: number;
  dayStarted: boolean;
  inTreeHub: boolean;
  timeRemaining: number;
  summaryReason: 'extracted' | 'time_up' | 'caught' | 'knocked_out' | null;
  shinies: number;
  scrap: number;
  upgrades: CraftUpgrades;
  quests: Quest[];
  players: Map<string, RoomPlayer>;
  props: Map<string, ServerProp>;
  insects: Map<string, ServerInsect>;
  human: ServerHuman;
  car: NetCarState;
  bossGnome: NetBossGnomeState;
  pets: NetPetsState;
  bossTimer: ReturnType<typeof setTimeout> | null;
  chat: ChatMessage[];
  emptySince: number | null;
  createdAt: number;
}

const DAY_DURATION = 240;
const MAX_PLAYERS = 6;
const EMPTY_ROOM_TTL_MS = 30_000;

const VALID_COLORS = new Set<GnomeColorId>(['red', 'blue', 'green', 'gold', 'purple', 'teal']);

function sanitizeColor(c: unknown): GnomeColorId {
  if (typeof c === 'string' && VALID_COLORS.has(c as GnomeColorId)) {
    return c as GnomeColorId;
  }
  return 'red';
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 20);
  return cleaned || fallback;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(existing: Map<string, GameRoom>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
}

function serializePlayer(p: RoomPlayer) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isHost: p.isHost,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    isCrouching: p.isCrouching,
    isClimbing: p.isClimbing,
    isGrounded: p.isGrounded,
    hasStick: p.hasStick,
    stickSwinging: p.stickSwinging,
    heldPropId: p.heldPropId,
    hp: p.hp,
    isDowned: p.isDowned,
    isGrabbed: p.isGrabbed,
    dismemberMask: p.dismemberMask,
    inCopter: p.inCopter,
    inCarSeat: p.inCarSeat,
  };
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room: GameRoom, payload: unknown, excludePlayerId?: string): void {
  const raw = JSON.stringify(payload);
  for (const [pid, player] of room.players) {
    if (excludePlayerId && pid === excludePlayerId) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(raw);
    }
  }
}

function pushSystemChat(room: GameRoom, text: string): ChatMessage {
  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    senderId: 'system',
    senderName: 'Сервер',
    senderColor: 'gold',
    text,
    timestamp: Date.now(),
    system: true,
  };
  room.chat.push(msg);
  if (room.chat.length > 30) room.chat.shift();
  return msg;
}

function recordRoomQuestProgress(room: GameRoom, category: ItemCategory, typeFilter?: QuestType): string[] {
  const completedTitles: string[] = [];
  for (const q of room.quests) {
    if (q.completed) continue;
    if (typeFilter && q.type !== typeFilter) continue;
    if (q.targetCategory === category) {
      q.currentCount += 1;
      if (q.currentCount >= q.requiredCount) {
        q.completed = true;
        room.shinies += q.rewardShinies;
        completedTitles.push(`${q.title} (+${q.rewardShinies} Блестяшек)`);
      }
    }
  }
  return completedTitles;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const rooms = new Map<string, GameRoom>();

  // Health & Server Browser API
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  app.get('/api/servers', (_req, res) => {
    const list = [];
    for (const room of rooms.values()) {
      if (!room.isPublic || room.players.size === 0) continue;
      const host = room.players.get(room.hostId);
      list.push({
        code: room.code,
        name: room.name,
        hostName: host?.name ?? 'Гном',
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        day: room.day,
        houseName: getHouseBlueprint(room.day).name,
        dayStarted: room.dayStarted,
        isPublic: room.isPublic,
      });
    }
    list.sort((a, b) => b.playerCount - a.playerCount);
    res.json({ servers: list });
  });

  app.get('/api/servers/:code', (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ error: 'Сервер с таким кодом не найден' });
      return;
    }
    const host = room.players.get(room.hostId);
    res.json({
      server: {
        code: room.code,
        name: room.name,
        hostName: host?.name ?? 'Гном',
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        day: room.day,
        houseName: getHouseBlueprint(room.day).name,
        dayStarted: room.dayStarted,
        isPublic: room.isPublic,
      },
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const socketToMeta = new Map<WebSocket, { playerId: string; roomCode: string }>();

  const removePlayerFromRoom = (ws: WebSocket, silent = false) => {
    const meta = socketToMeta.get(ws);
    if (!meta) return;
    socketToMeta.delete(ws);

    const room = rooms.get(meta.roomCode);
    if (!room) return;
    const leaving = room.players.get(meta.playerId);
    if (!leaving) return;

    // Release any held prop
    if (leaving.heldPropId) {
      const prop = room.props.get(leaving.heldPropId);
      if (prop && prop.heldBy === leaving.id) {
        prop.heldBy = null;
        broadcast(room, { type: 'prop:state', prop });
      }
    }

    // Release any car seat held by leaving player
    if (room.car.driverId === meta.playerId || room.car.passengerId === meta.playerId) {
      if (room.car.driverId === meta.playerId) room.car.driverId = null;
      if (room.car.passengerId === meta.playerId) room.car.passengerId = null;
      broadcast(room, { type: 'car:state', car: room.car });
    }

    room.players.delete(meta.playerId);

    if (room.players.size === 0) {
      room.emptySince = Date.now();
      return;
    }

    // Re-elect host if needed
    let newHostId = room.hostId;
    if (room.hostId === meta.playerId) {
      const nextHost = room.players.values().next().value as RoomPlayer | undefined;
      if (nextHost) {
        nextHost.isHost = true;
        room.hostId = nextHost.id;
        newHostId = nextHost.id;
      }
    }

    if (!silent) {
      const sysMsg = pushSystemChat(room, `${leaving.name} покинул сервер.`);
      broadcast(room, {
        type: 'player:left',
        playerId: meta.playerId,
        newHostId,
        chatMessage: sysMsg,
      });
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    const playerId = crypto.randomUUID().slice(0, 12);

    ws.on('message', (rawBuf) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawBuf.toString());
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'room:create') {
        removePlayerFromRoom(ws, true);

        const playerName = sanitizeName(msg.playerName, 'Гном');
        const color = sanitizeColor(msg.color);
        const serverName = sanitizeName(msg.serverName, `Нора ${playerName}`);
        const isPublic = Boolean(msg.isPublic ?? true);
        const startDay = Math.max(1, Math.floor(Number(msg.startDay || 1)));
        const house = getHouseBlueprint(startDay);
        const mx = (x: number) => (house.mirrorX ? 56 - x : x);
        const spawnBaseX = mx(28);
        const humanStartX = mx(5);
        const code = generateRoomCode(rooms);

        const propsMap = new Map<string, ServerProp>();
        if (Array.isArray(msg.initialProps)) {
          for (const item of msg.initialProps) {
            if (!item || typeof item !== 'object') continue;
            const p = item as Record<string, unknown>;
            const id = String(p.id || '');
            if (!id) continue;
            propsMap.set(id, {
              id,
              name: String(p.name || 'Предмет'),
              category: String(p.category || 'scrap') as ItemCategory,
              valueShinies: Number(p.valueShinies || 0),
              valueScrap: Number(p.valueScrap || 0),
              x: Number(p.x || 0),
              y: Number(p.y || 0),
              z: Number(p.z || 0),
              rx: 0,
              ry: 0,
              rz: 0,
              vx: 0,
              vy: 0,
              vz: 0,
              collected: false,
              broken: false,
              tipped: false,
              heldBy: null,
            });
          }
        }

        const insectsMap = new Map<string, ServerInsect>();
        if (Array.isArray(msg.initialInsects)) {
          for (const item of msg.initialInsects) {
            if (!item || typeof item !== 'object') continue;
            const ins = item as Record<string, unknown>;
            const id = String(ins.id || '');
            if (!id) continue;
            const hp = Number(ins.hp || 2);
            insectsMap.set(id, {
              id,
              x: Number(ins.x || 0),
              y: Number(ins.y || 0),
              z: Number(ins.z || 0),
              yaw: Number(ins.yaw || 0),
              hp,
              maxHp: hp,
              dead: false,
            });
          }
        }

        const player: RoomPlayer = {
          id: playerId,
          name: playerName,
          color,
          isHost: true,
          ws,
          x: spawnBaseX,
          y: 0,
          z: 150,
          yaw: 0,
          pitch: 0,
          isCrouching: false,
          isClimbing: false,
          isGrounded: true,
          hasStick: false,
          stickSwinging: false,
          heldPropId: null,
          hp: 100,
          isDowned: false,
          isGrabbed: false,
          dismemberMask: 0,
          inCopter: false,
          inCarSeat: 0,
        };

        const room: GameRoom = {
          code,
          name: serverName,
          isPublic,
          maxPlayers: MAX_PLAYERS,
          hostId: playerId,
          day: startDay,
          dayStarted: false,
          inTreeHub: true,
          timeRemaining: DAY_DURATION,
          summaryReason: null,
          shinies: 20,
          scrap: 1,
          upgrades: { stick: false, gloves: false, boots: false, drone: false },
          quests: generateDailyQuests(startDay),
          players: new Map([[playerId, player]]),
          props: propsMap,
          insects: insectsMap,
          human: {
            x: humanStartX,
            y: 0,
            z: -16,
            yaw: 0,
            hp: 120,
            maxHp: 120,
            dead: false,
            alert: 'patrol',
            weapon: 'broom',
            grabState: 'none',
            grabTargetId: null,
            aiming: false,
            startleTimer: 0,
            swipeTimer: 0,
          },
          car: {
            x: mx(108.5),
            y: 0,
            z: 54,
            yaw: house.mirrorX ? 0.25 : -0.25,
            speed: 0,
            steer: 0,
            driverId: null,
            passengerId: null,
          },
          bossGnome: {
            active: false,
            x: mx(-42),
            y: 0,
            z: 58,
            yaw: 0,
            swipeTimer: 0,
            roarTimer: 0,
          },
          pets: {
            dog: { x: mx(23), y: 0, z: 56, yaw: 0, alert: false, hitTimer: 0 },
            cat: { x: mx(32), y: 0, z: 4, yaw: 0, alert: false, hitTimer: 0 },
          },
          bossTimer: null,
          chat: [],
          emptySince: null,
          createdAt: Date.now(),
        };

        pushSystemChat(room, `Сервер ${code} создан (${house.name})! Зайдите в домик Дерева с глазами и нажмите PLAY.`);
        rooms.set(code, room);
        socketToMeta.set(ws, { playerId, roomCode: code });

        sendJson(ws, {
          type: 'room:joined',
          myId: playerId,
          room: {
            code: room.code,
            name: room.name,
            isPublic: room.isPublic,
            hostId: room.hostId,
            day: room.day,
            dayStarted: room.dayStarted,
            inTreeHub: room.inTreeHub,
            timeRemaining: room.timeRemaining,
            summaryReason: room.summaryReason,
            shinies: room.shinies,
            scrap: room.scrap,
            upgrades: room.upgrades,
            quests: room.quests,
            players: Array.from(room.players.values()).map(serializePlayer),
            props: Array.from(room.props.values()),
            insects: Array.from(room.insects.values()),
            human: room.human,
            car: room.car,
            bossGnome: room.bossGnome,
            pets: room.pets,
            chat: room.chat,
          },
        });
        return;
      }

      if (type === 'room:join') {
        removePlayerFromRoom(ws, true);

        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: `Сервер с кодом "${code || '???'}" не найден.` });
          return;
        }
        if (room.players.size >= room.maxPlayers) {
          sendJson(ws, { type: 'room:error', message: `Сервер "${code}" переполнен (${room.maxPlayers}/${room.maxPlayers}).` });
          return;
        }

        room.emptySince = null;
        const playerName = sanitizeName(msg.playerName, 'Гном');
        const color = sanitizeColor(msg.color);
        const shouldBeHost = room.players.size === 0;
        if (shouldBeHost) {
          room.hostId = playerId;
        }

        const house = getHouseBlueprint(room.day);
        const mx = (x: number) => (house.mirrorX ? 56 - x : x);
        const spawnBaseX = room.inTreeHub ? mx(28) : mx(44);
        const spawnBaseZ = room.inTreeHub ? 150 : 62;
        const slotOffset = (room.players.size % 5) - 2;
        const player: RoomPlayer = {
          id: playerId,
          name: playerName,
          color,
          isHost: shouldBeHost,
          ws,
          x: spawnBaseX + slotOffset * 1.1,
          y: 0,
          z: spawnBaseZ,
          yaw: 0,
          pitch: 0,
          isCrouching: false,
          isClimbing: false,
          isGrounded: true,
          hasStick: room.upgrades.stick,
          stickSwinging: false,
          heldPropId: null,
          hp: 100,
          isDowned: false,
          isGrabbed: false,
          dismemberMask: 0,
          inCopter: false,
          inCarSeat: 0,
        };

        room.players.set(playerId, player);
        socketToMeta.set(ws, { playerId, roomCode: code });

        const joinChat = pushSystemChat(room, `${player.name} присоединился к вылазке!`);
        const serialized = serializePlayer(player);

        sendJson(ws, {
          type: 'room:joined',
          myId: playerId,
          room: {
            code: room.code,
            name: room.name,
            isPublic: room.isPublic,
            hostId: room.hostId,
            day: room.day,
            dayStarted: room.dayStarted,
            inTreeHub: room.inTreeHub,
            timeRemaining: room.timeRemaining,
            summaryReason: room.summaryReason,
            shinies: room.shinies,
            scrap: room.scrap,
            upgrades: room.upgrades,
            quests: room.quests,
            players: Array.from(room.players.values()).map(serializePlayer),
            props: Array.from(room.props.values()),
            insects: Array.from(room.insects.values()),
            human: room.human,
            car: room.car,
            bossGnome: room.bossGnome,
            pets: room.pets,
            chat: room.chat,
          },
        });

        broadcast(
          room,
          {
            type: 'player:joined',
            player: serialized,
            chatMessage: joinChat,
          },
          playerId
        );
        return;
      }

      if (type === 'room:leave') {
        removePlayerFromRoom(ws, false);
        return;
      }

      const meta = socketToMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      const player = room.players.get(meta.playerId);
      if (!player) return;

      if (type === 'player:update') {
        player.x = Number(msg.x ?? player.x);
        player.y = Number(msg.y ?? player.y);
        player.z = Number(msg.z ?? player.z);
        player.yaw = Number(msg.yaw ?? player.yaw);
        player.pitch = Number(msg.pitch ?? player.pitch);
        player.isCrouching = Boolean(msg.isCrouching);
        player.isClimbing = Boolean(msg.isClimbing);
        player.isGrounded = Boolean(msg.isGrounded ?? true);
        player.hasStick = room.upgrades.stick;
        player.stickSwinging = Boolean(msg.stickSwinging);
        player.hp = Math.max(0, Math.min(100, Number(msg.hp ?? player.hp)));
        player.isDowned = Boolean(msg.isDowned);
        player.isGrabbed = Boolean(msg.isGrabbed);
        player.dismemberMask = Math.max(0, Number(msg.dismemberMask ?? 0)) | 0;
        player.inCopter = Boolean(msg.inCopter);
        const seatRaw = Number(msg.inCarSeat ?? 0);
        player.inCarSeat = seatRaw === 1 ? 1 : seatRaw === 2 ? 2 : 0;

        // If all players are simultaneously downed during active raid -> end day
        if (room.dayStarted && !room.summaryReason && room.players.size > 0) {
          let allDown = true;
          for (const p of room.players.values()) {
            if (!p.isDowned) {
              allDown = false;
              break;
            }
          }
          if (allDown) {
            room.summaryReason = 'caught';
            broadcast(room, { type: 'day:finished', reason: 'caught' });
          }
        }

        broadcast(
          room,
          {
            type: 'player:moved',
            player: serializePlayer(player),
          },
          playerId
        );
        return;
      }

      if (type === 'day:start') {
        if (!room.dayStarted && !room.summaryReason) {
          room.dayStarted = true;
          const sys = pushSystemChat(room, `Вылазка Дня ${room.day} началась!`);
          broadcast(room, {
            type: 'day:state',
            dayStarted: true,
            timeRemaining: room.timeRemaining,
            chatMessage: sys,
          });
        }
        return;
      }

      if (type === 'hub:play') {
        if (room.inTreeHub) {
          room.inTreeHub = false;
          room.dayStarted = true;
          const house = getHouseBlueprint(room.day);
          const arrivalX = house.mirrorX ? 56 - 44 : 44;
          let slot = 0;
          for (const p of room.players.values()) {
            const off = (slot % 5) - 2;
            p.x = arrivalX + off * 1.1;
            p.y = 0;
            p.z = 62;
            p.yaw = 0;
            slot++;
          }
          const sys = pushSystemChat(room, `${player.name} нажал PLAY! Вылазка к дому соседа началась!`);
          broadcast(room, {
            type: 'hub:deployed',
            triggeredBy: player.name,
            chatMessage: sys,
          });
        }
        return;
      }

      if (type === 'car:enter') {
        if (room.car.driverId === playerId || room.car.passengerId === playerId) return;
        let seat: 0 | 1 | 2 = 0;
        if (!room.car.driverId) {
          room.car.driverId = playerId;
          seat = 1;
        } else if (!room.car.passengerId) {
          room.car.passengerId = playerId;
          seat = 2;
        }
        if (seat > 0) {
          player.inCarSeat = seat;
          broadcast(room, { type: 'car:state', car: room.car });
        }
        return;
      }

      if (type === 'car:exit') {
        if (room.car.driverId === playerId || room.car.passengerId === playerId) {
          if (room.car.driverId === playerId) room.car.driverId = null;
          if (room.car.passengerId === playerId) room.car.passengerId = null;
          player.inCarSeat = 0;
          broadcast(room, { type: 'car:state', car: room.car });
        }
        return;
      }

      if (type === 'car:update') {
        if (room.car.driverId === playerId) {
          room.car.x = Number(msg.x ?? room.car.x);
          room.car.y = Number(msg.y ?? room.car.y);
          room.car.z = Number(msg.z ?? room.car.z);
          room.car.yaw = Number(msg.yaw ?? room.car.yaw);
          room.car.speed = Number(msg.speed ?? room.car.speed);
          room.car.steer = Number(msg.steer ?? room.car.steer);
          broadcast(room, { type: 'car:state', car: room.car }, playerId);
        }
        return;
      }

      if (type === 'human:damage') {
        if (room.human.dead || room.inTreeHub) return;
        const dmg = Math.max(1, Math.min(80, Number(msg.damage || 15)));
        room.human.hp = Math.max(0, room.human.hp - dmg);
        if (room.human.hp <= 0) {
          room.human.dead = true;
          room.human.grabState = 'none';
          room.human.grabTargetId = null;
          room.human.aiming = false;
          const sys = pushSystemChat(room, `${player.name} одолел Соседа! Берегитесь — на звуки идёт БОЛЬШОЙ ГНОМ!`);
          broadcast(room, {
            type: 'human:damaged',
            hp: 0,
            maxHp: room.human.maxHp,
            dead: true,
            killedBy: player.name,
            chatMessage: sys,
          });
          if (!room.bossGnome.active && !room.bossTimer) {
            room.bossTimer = setTimeout(() => {
              room.bossTimer = null;
              if (room.summaryReason || room.inTreeHub) return;
              const h = getHouseBlueprint(room.day);
              const mx = (x: number) => (h.mirrorX ? 56 - x : x);
              room.bossGnome = {
                active: true,
                x: mx(-42),
                y: 0,
                z: 58,
                yaw: 0,
                swipeTimer: 0,
                roarTimer: 1.5,
              };
              const roarChat = pushSystemChat(room, 'БОЛЬШОЙ ГНОМ ворвался во двор и охотится на вас!');
              broadcast(room, {
                type: 'boss:spawned',
                bossGnome: room.bossGnome,
                chatMessage: roarChat,
              });
            }, 2200);
          }
        } else {
          broadcast(room, {
            type: 'human:damaged',
            hp: room.human.hp,
            maxHp: room.human.maxHp,
            dead: false,
          });
        }
        return;
      }

      if (type === 'prop:grab') {
        const propId = String(msg.propId || '');
        const prop = room.props.get(propId);
        if (!prop || prop.collected || prop.broken || (prop.heldBy && prop.heldBy !== playerId)) {
          sendJson(ws, { type: 'prop:grab_denied', propId, heldBy: prop?.heldBy ?? null });
          return;
        }
        // Release any previous held prop
        if (player.heldPropId && player.heldPropId !== propId) {
          const prev = room.props.get(player.heldPropId);
          if (prev && prev.heldBy === playerId) {
            prev.heldBy = null;
            broadcast(room, { type: 'prop:state', prop: prev });
          }
        }
        prop.heldBy = playerId;
        player.heldPropId = propId;
        broadcast(room, { type: 'prop:state', prop });
        return;
      }

      if (type === 'prop:move') {
        const propId = String(msg.propId || '');
        const prop = room.props.get(propId);
        if (!prop || prop.heldBy !== playerId) return;
        prop.x = Number(msg.x ?? prop.x);
        prop.y = Number(msg.y ?? prop.y);
        prop.z = Number(msg.z ?? prop.z);
        prop.rx = Number(msg.rx ?? prop.rx);
        prop.ry = Number(msg.ry ?? prop.ry);
        prop.rz = Number(msg.rz ?? prop.rz);
        prop.vx = Number(msg.vx ?? 0);
        prop.vy = Number(msg.vy ?? 0);
        prop.vz = Number(msg.vz ?? 0);
        broadcast(room, { type: 'prop:moved', prop }, playerId);
        return;
      }

      if (type === 'prop:release') {
        const propId = String(msg.propId || '');
        const prop = room.props.get(propId);
        if (!prop || prop.heldBy !== playerId) return;
        prop.heldBy = null;
        if (player.heldPropId === propId) player.heldPropId = null;
        prop.x = Number(msg.x ?? prop.x);
        prop.y = Number(msg.y ?? prop.y);
        prop.z = Number(msg.z ?? prop.z);
        prop.rx = Number(msg.rx ?? prop.rx);
        prop.ry = Number(msg.ry ?? prop.ry);
        prop.rz = Number(msg.rz ?? prop.rz);
        prop.vx = Number(msg.vx ?? 0);
        prop.vy = Number(msg.vy ?? 0);
        prop.vz = Number(msg.vz ?? 0);
        broadcast(room, { type: 'prop:state', prop });
        return;
      }

      if (type === 'prop:collect') {
        const propId = String(msg.propId || '');
        const prop = room.props.get(propId);
        if (!prop || prop.collected || prop.broken) return;
        prop.collected = true;
        if (prop.heldBy) {
          const holder = room.players.get(prop.heldBy);
          if (holder && holder.heldPropId === propId) holder.heldPropId = null;
        }
        prop.heldBy = null;
        room.shinies += prop.valueShinies;
        room.scrap += prop.valueScrap;
        const completedTitles = recordRoomQuestProgress(room, prop.category);
        broadcast(room, {
          type: 'prop:collected',
          propId,
          collectorName: player.name,
          propName: prop.name,
          valueShinies: prop.valueShinies,
          shinies: room.shinies,
          scrap: room.scrap,
          quests: room.quests,
          completedTitles,
        });
        return;
      }

      if (type === 'prop:break') {
        const propId = String(msg.propId || '');
        const prop = room.props.get(propId);
        if (!prop || prop.broken || prop.collected) return;
        prop.broken = true;
        prop.heldBy = null;
        prop.x = Number(msg.x ?? prop.x);
        prop.y = Number(msg.y ?? prop.y);
        prop.z = Number(msg.z ?? prop.z);
        const completedTitles = recordRoomQuestProgress(room, prop.category, 'vandalism');
        broadcast(room, {
          type: 'prop:broken',
          propId,
          x: prop.x,
          y: prop.y,
          z: prop.z,
          shinies: room.shinies,
          scrap: room.scrap,
          quests: room.quests,
          completedTitles,
        });
        return;
      }

      if (type === 'prop:tip') {
        const propId = String(msg.propId || '');
        const prop = room.props.get(propId);
        if (!prop || prop.tipped) return;
        prop.tipped = true;
        prop.x = Number(msg.x ?? prop.x);
        prop.y = Number(msg.y ?? prop.y);
        prop.z = Number(msg.z ?? prop.z);
        const completedTitles = recordRoomQuestProgress(room, 'trashbin', 'vandalism');
        broadcast(room, {
          type: 'prop:tipped',
          propId,
          x: prop.x,
          y: prop.y,
          z: prop.z,
          shinies: room.shinies,
          scrap: room.scrap,
          quests: room.quests,
          completedTitles,
        });
        return;
      }

      if (type === 'insect:hit') {
        const insectId = String(msg.insectId || '');
        const ins = room.insects.get(insectId);
        if (!ins || ins.dead) return;
        const dmg = Math.max(1, Number(msg.damage || 1));
        ins.hp = Math.max(0, ins.hp - dmg);
        if (ins.hp <= 0) {
          ins.dead = true;
          room.shinies += 6;
          room.scrap += 1;
        }
        broadcast(room, {
          type: 'insect:hit',
          insectId,
          hp: ins.hp,
          dead: ins.dead,
          vx: Number(msg.vx || 0),
          vy: Number(msg.vy || 0),
          vz: Number(msg.vz || 0),
          shinies: room.shinies,
          scrap: room.scrap,
          killerName: player.name,
        });
        return;
      }

      if (type === 'craft:buy') {
        const item = String(msg.item || '') as keyof CraftUpgrades;
        if (item !== 'stick' && item !== 'gloves' && item !== 'boots' && item !== 'drone') return;
        if (room.upgrades[item]) return;

        let craftedLabel = '';
        if (item === 'stick') {
          if (room.scrap < 2 && room.shinies < 20) return;
          if (room.scrap >= 2) room.scrap -= 2;
          else room.shinies -= 20;
          room.upgrades.stick = true;
          for (const p of room.players.values()) p.hasStick = true;
          craftedLabel = 'Дубинку-палку';
        } else if (item === 'gloves') {
          if (room.shinies < 35) return;
          room.shinies -= 35;
          room.upgrades.gloves = true;
          craftedLabel = 'Перчатки Гномиума';
        } else if (item === 'boots') {
          if (room.shinies < 45) return;
          room.shinies -= 45;
          room.upgrades.boots = true;
          craftedLabel = 'Прыгучие ботинки';
        } else {
          if (room.scrap < 2 && room.shinies < 30) return;
          if (room.scrap >= 2) room.scrap -= 2;
          else room.shinies -= 30;
          room.upgrades.drone = true;
          craftedLabel = 'Мавик-Дрон гномов';
        }

        const sys = pushSystemChat(room, `${player.name} скрафтил ${craftedLabel} для всей команды!`);
        broadcast(room, {
          type: 'craft:updated',
          upgrades: room.upgrades,
          shinies: room.shinies,
          scrap: room.scrap,
          craftedBy: player.name,
          item,
          chatMessage: sys,
        });
        return;
      }

      if (type === 'world:sync') {
        if (room.hostId !== playerId) return;
        if (msg.human && typeof msg.human === 'object') {
          const h = msg.human as Record<string, unknown>;
          room.human = {
            x: Number(h.x ?? room.human.x),
            y: Number(h.y ?? room.human.y),
            z: Number(h.z ?? room.human.z),
            yaw: Number(h.yaw ?? room.human.yaw),
            hp: room.human.hp,
            maxHp: room.human.maxHp,
            dead: room.human.dead,
            alert: (h.alert as HumanAlertState) ?? room.human.alert,
            weapon: (h.weapon as HumanWeapon) ?? room.human.weapon,
            grabState: (h.grabState as ServerHuman['grabState']) ?? 'none',
            grabTargetId: h.grabTargetId ? String(h.grabTargetId) : null,
            aiming: Boolean(h.aiming),
            startleTimer: Number(h.startleTimer ?? 0),
            swipeTimer: Number(h.swipeTimer ?? 0),
          };
        }

        if (msg.bossGnome && typeof msg.bossGnome === 'object') {
          const bg = msg.bossGnome as Record<string, unknown>;
          room.bossGnome = {
            active: room.bossGnome.active,
            x: Number(bg.x ?? room.bossGnome.x),
            y: Number(bg.y ?? room.bossGnome.y),
            z: Number(bg.z ?? room.bossGnome.z),
            yaw: Number(bg.yaw ?? room.bossGnome.yaw),
            swipeTimer: Number(bg.swipeTimer ?? 0),
            roarTimer: Number(bg.roarTimer ?? 0),
          };
        }

        if (msg.pets && typeof msg.pets === 'object') {
          const ps = msg.pets as { dog?: Record<string, unknown>; cat?: Record<string, unknown> };
          if (ps.dog) {
            room.pets.dog = {
              x: Number(ps.dog.x ?? room.pets.dog.x),
              y: Number(ps.dog.y ?? room.pets.dog.y),
              z: Number(ps.dog.z ?? room.pets.dog.z),
              yaw: Number(ps.dog.yaw ?? room.pets.dog.yaw),
              alert: Boolean(ps.dog.alert),
              hitTimer: Number(ps.dog.hitTimer ?? 0),
            };
          }
          if (ps.cat) {
            room.pets.cat = {
              x: Number(ps.cat.x ?? room.pets.cat.x),
              y: Number(ps.cat.y ?? room.pets.cat.y),
              z: Number(ps.cat.z ?? room.pets.cat.z),
              yaw: Number(ps.cat.yaw ?? room.pets.cat.yaw),
              alert: Boolean(ps.cat.alert),
              hitTimer: Number(ps.cat.hitTimer ?? 0),
            };
          }
        }

        if (Array.isArray(msg.props)) {
          for (const rawP of msg.props) {
            if (!rawP || typeof rawP !== 'object') continue;
            const rp = rawP as Record<string, unknown>;
            const sp = room.props.get(String(rp.id || ''));
            if (!sp || sp.collected || sp.broken || sp.heldBy) continue;
            sp.x = Number(rp.x ?? sp.x);
            sp.y = Number(rp.y ?? sp.y);
            sp.z = Number(rp.z ?? sp.z);
            sp.rx = Number(rp.rx ?? sp.rx);
            sp.ry = Number(rp.ry ?? sp.ry);
            sp.rz = Number(rp.rz ?? sp.rz);
            sp.vx = Number(rp.vx ?? 0);
            sp.vy = Number(rp.vy ?? 0);
            sp.vz = Number(rp.vz ?? 0);
          }
        }

        if (Array.isArray(msg.insects)) {
          for (const rawI of msg.insects) {
            if (!rawI || typeof rawI !== 'object') continue;
            const ri = rawI as Record<string, unknown>;
            const si = room.insects.get(String(ri.id || ''));
            if (!si || si.dead) continue;
            si.x = Number(ri.x ?? si.x);
            si.y = Number(ri.y ?? si.y);
            si.z = Number(ri.z ?? si.z);
            si.yaw = Number(ri.yaw ?? si.yaw);
          }
        }

        broadcast(
          room,
          {
            type: 'world:sync',
            human: room.human,
            props: Array.from(room.props.values()),
            insects: Array.from(room.insects.values()),
            car: room.car,
            bossGnome: room.bossGnome,
            pets: room.pets,
          },
          playerId
        );
        return;
      }

      if (type === 'human:shoot') {
        if (room.hostId !== playerId) return;
        broadcast(
          room,
          {
            type: 'human:shoot',
            weapon: msg.weapon,
            origin: msg.origin,
            bullets: msg.bullets,
          },
          playerId
        );
        return;
      }

      if (type === 'human:throw_player') {
        if (room.hostId !== playerId) return;
        const targetId = String(msg.targetId || '');
        const target = room.players.get(targetId);
        if (target) {
          const house = getHouseBlueprint(room.day);
          sendJson(target.ws, {
            type: 'human:thrown',
            x: Number(msg.x ?? (house.mirrorX ? 3 : 53)),
            y: Number(msg.y ?? 5),
            z: Number(msg.z ?? 41),
            vx: Number(msg.vx ?? 0),
            vy: Number(msg.vy ?? 11.5),
            vz: Number(msg.vz ?? 22.5),
            damage: Number(msg.damage ?? 20),
          });
        }
        return;
      }

      if (type === 'human:escape') {
        const host = room.players.get(room.hostId);
        if (host && room.human.grabTargetId === playerId) {
          sendJson(host.ws, { type: 'human:escaped', playerId });
        }
        return;
      }

      if (type === 'day:extract' || type === 'day:next' || type === 'day:retry') {
        if (room.hostId !== playerId) return;

        if (type === 'day:extract') {
          const done = room.quests.filter((q) => q.completed).length;
          if (done >= 3 && !room.summaryReason) {
            room.summaryReason = 'extracted';
            broadcast(room, { type: 'day:finished', reason: 'extracted' });
          }
          return;
        }

        const nextDay = type === 'day:next' ? room.day + 1 : room.day;
        const house = getHouseBlueprint(nextDay);
        const mx = (x: number) => (house.mirrorX ? 56 - x : x);
        const spawnBaseX = mx(28);
        const humanStartX = mx(5);

        if (room.bossTimer) {
          clearTimeout(room.bossTimer);
          room.bossTimer = null;
        }

        room.day = nextDay;
        room.dayStarted = false;
        room.inTreeHub = true;
        room.timeRemaining = DAY_DURATION;
        room.summaryReason = null;
        room.quests = generateDailyQuests(nextDay);
        room.human = {
          x: humanStartX,
          y: 0,
          z: -16,
          yaw: 0,
          hp: 120,
          maxHp: 120,
          dead: false,
          alert: 'patrol',
          weapon: 'broom',
          grabState: 'none',
          grabTargetId: null,
          aiming: false,
          startleTimer: 0,
          swipeTimer: 0,
        };
        room.car = {
          x: mx(108.5),
          y: 0,
          z: 54,
          yaw: house.mirrorX ? 0.25 : -0.25,
          speed: 0,
          steer: 0,
          driverId: null,
          passengerId: null,
        };
        room.bossGnome = {
          active: false,
          x: mx(-42),
          y: 0,
          z: 58,
          yaw: 0,
          swipeTimer: 0,
          roarTimer: 0,
        };
        room.pets = {
          dog: { x: mx(23), y: 0, z: 56, yaw: 0, alert: false, hitTimer: 0 },
          cat: { x: mx(32), y: 0, z: 4, yaw: 0, alert: false, hitTimer: 0 },
        };

        if (Array.isArray(msg.resetProps)) {
          room.props.clear();
          for (const rawP of msg.resetProps) {
            if (!rawP || typeof rawP !== 'object') continue;
            const rp = rawP as Record<string, unknown>;
            const id = String(rp.id || '');
            if (!id) continue;
            room.props.set(id, {
              id,
              name: String(rp.name || 'Предмет'),
              category: String(rp.category || 'scrap') as ItemCategory,
              valueShinies: Number(rp.valueShinies || 0),
              valueScrap: Number(rp.valueScrap || 0),
              x: Number(rp.x || 0),
              y: Number(rp.y || 0),
              z: Number(rp.z || 0),
              rx: 0,
              ry: 0,
              rz: 0,
              vx: 0,
              vy: 0,
              vz: 0,
              collected: false,
              broken: false,
              tipped: false,
              heldBy: null,
            });
          }
        }
        if (Array.isArray(msg.resetInsects)) {
          room.insects.clear();
          for (const rawI of msg.resetInsects) {
            if (!rawI || typeof rawI !== 'object') continue;
            const ri = rawI as Record<string, unknown>;
            const id = String(ri.id || '');
            if (!id) continue;
            const hp = Number(ri.hp || 2);
            room.insects.set(id, {
              id,
              x: Number(ri.x || 0),
              y: Number(ri.y || 0),
              z: Number(ri.z || 0),
              yaw: Number(ri.yaw || 0),
              hp,
              maxHp: hp,
              dead: false,
            });
          }
        }

        let playerSlot = 0;
        for (const p of room.players.values()) {
          const slotOffset = (playerSlot % 5) - 2;
          p.x = spawnBaseX + slotOffset * 1.1;
          p.y = 0;
          p.z = 150;
          p.hp = 100;
          p.isDowned = false;
          p.isGrabbed = false;
          p.dismemberMask = 0;
          p.inCopter = false;
          p.inCarSeat = 0;
          p.heldPropId = null;
          playerSlot++;
        }

        const sys = pushSystemChat(room, `День ${nextDay} · ${house.name}! Зайдите в домик Дерева с глазами и нажмите PLAY.`);
        broadcast(room, {
          type: 'day:reset',
          day: room.day,
          timeRemaining: room.timeRemaining,
          inTreeHub: true,
          quests: room.quests,
          props: Array.from(room.props.values()),
          insects: Array.from(room.insects.values()),
          human: room.human,
          car: room.car,
          bossGnome: room.bossGnome,
          pets: room.pets,
          chatMessage: sys,
        });
        return;
      }

      if (type === 'chat:send') {
        const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        if (!text) return;
        const chatMsg: ChatMessage = {
          id: crypto.randomUUID(),
          senderId: player.id,
          senderName: player.name,
          senderColor: player.color,
          text,
          timestamp: Date.now(),
        };
        room.chat.push(chatMsg);
        if (room.chat.length > 30) room.chat.shift();
        broadcast(room, { type: 'chat:message', message: chatMsg });
      }
    });

    ws.on('close', () => {
      removePlayerFromRoom(ws, false);
    });
  });

  // Authoritative 1Hz room timer & empty-room garbage collection
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.players.size === 0) {
        if (room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
          rooms.delete(code);
        }
        continue;
      }

      if (room.dayStarted && !room.summaryReason) {
        room.timeRemaining = Math.max(0, room.timeRemaining - 1);
        broadcast(room, {
          type: 'day:tick',
          timeRemaining: room.timeRemaining,
        });
        if (room.timeRemaining <= 0) {
          const done = room.quests.filter((q) => q.completed).length;
          room.summaryReason = done >= 3 ? 'extracted' : 'time_up';
          broadcast(room, { type: 'day:finished', reason: room.summaryReason });
        }
      }
    }
  }, 1000);

  // Mount Vite dev middleware or serve built static files
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Burglin' Gnomes server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
