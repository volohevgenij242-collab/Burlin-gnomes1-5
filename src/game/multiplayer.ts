import {
  ChatMessage,
  CraftUpgrades,
  GnomeColorId,
  NetBossGnomeState,
  NetCarState,
  NetHumanState,
  NetInsectState,
  NetPetsState,
  NetPlayerState,
  NetPropState,
  Quest,
  ServerListing,
} from '../types/game';

export interface RoomJoinedPayload {
  myId: string;
  room: {
    code: string;
    name: string;
    isPublic: boolean;
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
    players: NetPlayerState[];
    props: NetPropState[];
    insects: NetInsectState[];
    human: NetHumanState;
    car: NetCarState;
    bossGnome: NetBossGnomeState;
    pets: NetPetsState;
    chat: ChatMessage[];
  };
}

export type ServerEvent =
  | { type: 'room:joined'; myId: string; room: RoomJoinedPayload['room'] }
  | { type: 'room:error'; message: string }
  | { type: 'player:joined'; player: NetPlayerState; chatMessage: ChatMessage }
  | { type: 'player:left'; playerId: string; newHostId: string; chatMessage: ChatMessage }
  | { type: 'player:moved'; player: NetPlayerState }
  | { type: 'day:state'; dayStarted: boolean; timeRemaining: number; chatMessage?: ChatMessage }
  | { type: 'day:tick'; timeRemaining: number }
  | { type: 'day:finished'; reason: 'extracted' | 'time_up' | 'caught' | 'knocked_out' }
  | {
      type: 'hub:deployed';
      triggeredBy: string;
      chatMessage: ChatMessage;
    }
  | {
      type: 'day:reset';
      day: number;
      timeRemaining: number;
      inTreeHub: boolean;
      quests: Quest[];
      chatMessage: ChatMessage;
      props?: NetPropState[];
      insects?: NetInsectState[];
      human?: NetHumanState;
      car?: NetCarState;
      bossGnome?: NetBossGnomeState;
      pets?: NetPetsState;
    }
  | { type: 'prop:state'; prop: NetPropState }
  | { type: 'prop:moved'; prop: NetPropState }
  | { type: 'prop:grab_denied'; propId: string; heldBy: string | null }
  | {
      type: 'prop:collected';
      propId: string;
      collectorName: string;
      propName: string;
      valueShinies: number;
      shinies: number;
      scrap: number;
      quests: Quest[];
      completedTitles: string[];
    }
  | {
      type: 'prop:broken';
      propId: string;
      x: number;
      y: number;
      z: number;
      shinies: number;
      scrap: number;
      quests: Quest[];
      completedTitles: string[];
    }
  | {
      type: 'prop:tipped';
      propId: string;
      x: number;
      y: number;
      z: number;
      shinies: number;
      scrap: number;
      quests: Quest[];
      completedTitles: string[];
    }
  | {
      type: 'insect:hit';
      insectId: string;
      hp: number;
      dead: boolean;
      vx: number;
      vy: number;
      vz: number;
      shinies: number;
      scrap: number;
      killerName: string;
    }
  | {
      type: 'craft:updated';
      upgrades: CraftUpgrades;
      shinies: number;
      scrap: number;
      craftedBy: string;
      item: keyof CraftUpgrades;
      chatMessage: ChatMessage;
    }
  | {
      type: 'world:sync';
      human: NetHumanState;
      props: NetPropState[];
      insects: NetInsectState[];
      car?: NetCarState;
      bossGnome?: NetBossGnomeState;
      pets?: NetPetsState;
    }
  | {
      type: 'car:state';
      car: NetCarState;
    }
  | {
      type: 'human:damaged';
      hp: number;
      maxHp: number;
      dead: boolean;
      killedBy?: string;
      chatMessage?: ChatMessage;
    }
  | {
      type: 'boss:spawned';
      bossGnome: NetBossGnomeState;
      chatMessage: ChatMessage;
    }
  | {
      type: 'human:shoot';
      weapon: 'revolver' | 'rifle' | 'shotgun';
      origin: { x: number; y: number; z: number };
      bullets: Array<{ vx: number; vy: number; vz: number; damage: number }>;
    }
  | {
      type: 'human:thrown';
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      damage: number;
    }
  | { type: 'human:escaped'; playerId: string }
  | { type: 'chat:message'; message: ChatMessage };

export async function fetchPublicServers(): Promise<ServerListing[]> {
  const res = await fetch('/api/servers', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось загрузить список серверов');
  const data = (await res.json()) as { servers?: ServerListing[] };
  return data.servers ?? [];
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private onEvent: (ev: ServerEvent) => void;
  private onConnectionStatus: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  private manualDisconnect = false;
  private reconnectTimer: number | null = null;
  private lastJoinAttempt:
    | { mode: 'join'; code: string; playerName: string; color: GnomeColorId }
    | null = null;

  constructor(
    onEvent: (ev: ServerEvent) => void,
    onConnectionStatus: (status: 'connected' | 'reconnecting' | 'disconnected') => void
  ) {
    this.onEvent = onEvent;
    this.onConnectionStatus = onConnectionStatus;
  }

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  private openSocket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.getWsUrl());
      let settled = false;

      ws.onopen = () => {
        settled = true;
        this.ws = ws;
        this.onConnectionStatus('connected');
        resolve(ws);
      };

      ws.onmessage = (e) => {
        try {
          const parsed = JSON.parse(String(e.data)) as ServerEvent;
          if (parsed.type === 'room:joined' && this.lastJoinAttempt) {
            this.lastJoinAttempt.code = parsed.room.code;
          }
          this.onEvent(parsed);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Ошибка подключения к серверу'));
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        if (!this.manualDisconnect && this.lastJoinAttempt) {
          this.onConnectionStatus('reconnecting');
          this.scheduleReconnect();
        } else {
          this.onConnectionStatus('disconnected');
        }
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manualDisconnect || !this.lastJoinAttempt) return;
      try {
        const ws = await this.openSocket();
        ws.send(
          JSON.stringify({
            type: 'room:join',
            code: this.lastJoinAttempt.code,
            playerName: this.lastJoinAttempt.playerName,
            color: this.lastJoinAttempt.color,
          })
        );
      } catch {
        this.scheduleReconnect();
      }
    }, 1800);
  }

  public async createRoom(params: {
    playerName: string;
    color: GnomeColorId;
    serverName: string;
    isPublic: boolean;
    startDay?: number;
    initialProps: Array<{
      id: string;
      name: string;
      category: string;
      valueShinies: number;
      valueScrap: number;
      x: number;
      y: number;
      z: number;
    }>;
    initialInsects: Array<{ id: string; x: number; y: number; z: number; yaw: number; hp: number }>;
  }): Promise<void> {
    this.manualDisconnect = false;
    this.lastJoinAttempt = {
      mode: 'join',
      code: '',
      playerName: params.playerName,
      color: params.color,
    };
    const ws = await this.openSocket();
    ws.send(
      JSON.stringify({
        type: 'room:create',
        ...params,
      })
    );
  }

  public async joinRoom(params: {
    code: string;
    playerName: string;
    color: GnomeColorId;
  }): Promise<void> {
    this.manualDisconnect = false;
    const normalizedCode = params.code.trim().toUpperCase();
    this.lastJoinAttempt = {
      mode: 'join',
      code: normalizedCode,
      playerName: params.playerName,
      color: params.color,
    };
    const ws = await this.openSocket();
    ws.send(
      JSON.stringify({
        type: 'room:join',
        code: normalizedCode,
        playerName: params.playerName,
        color: params.color,
      })
    );
  }

  public send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.lastJoinAttempt = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'room:leave' }));
        }
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.onConnectionStatus('disconnected');
  }
}
