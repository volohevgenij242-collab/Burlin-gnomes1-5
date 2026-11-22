import * as THREE from 'three';

export type GameScreen = 'title' | 'playing' | 'paused' | 'workbench' | 'highgnome' | 'summary';

export type ItemCategory =
  | 'battery'
  | 'fork'
  | 'spoon'
  | 'cheese'
  | 'coin'
  | 'matchbox'
  | 'mug'
  | 'scrap'
  | 'trashbin'
  | 'key'
  | 'ring'
  | 'watch'
  | 'apple'
  | 'candle'
  | 'vase'
  | 'plate'
  | 'remote';

export type QuestType = 'steal' | 'vandalism' | 'resource';

export interface HouseSummary {
  id: number; // 1..100
  name: string;
  district: string;
  themeLabel: string;
  moodLabel: string;
  layoutName: string;
}

export interface Quest {
  id: string;
  type: QuestType;
  targetCategory: ItemCategory;
  title: string;
  description: string;
  requiredCount: number;
  currentCount: number;
  completed: boolean;
  rewardShinies: number;
}

export interface CraftUpgrades {
  stick: boolean;
  gloves: boolean;
  boots: boolean;
  drone: boolean;
}

export interface AABBCollider {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  isFloorLike?: boolean;
  room?: string;
}

export interface ClimbableZone {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  normal: THREE.Vector3;
  label: string;
}

export interface HideZone {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  label: string;
}

export interface InteractiveProp {
  id: string;
  name: string;
  category: ItemCategory;
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  radius: number;
  halfHeight: number;
  weight: number; // 1 = light, 2 = medium, 3 = heavy, 5 = extra heavy (trash bin)
  valueShinies: number;
  valueScrap: number;
  grabbable: boolean;
  breakable?: boolean;
  broken?: boolean;
  isTrashBin?: boolean;
  tipped?: boolean;
  collected?: boolean;
  isHeld?: boolean;
  lastImpactSpeed?: number;
  spawnPos: THREE.Vector3;
  questMarker?: THREE.Mesh;
}

export interface InsectEntity {
  id: string;
  kind: 'cockroach' | 'spider';
  mesh: THREE.Group;
  bodyGroup: THREE.Group;
  legs: THREE.Object3D[];
  antennae: THREE.Object3D[];
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  homePos: THREE.Vector3;
  patrolTarget: THREE.Vector3;
  attackCooldown: number;
  hitFlash: number;
  dead: boolean;
  deathTimer: number;
}

export type HumanAlertState = 'patrol' | 'suspicious' | 'chase';

export type HumanWeapon = 'broom' | 'revolver' | 'rifle' | 'shotgun';

export type GnomeColorId = 'red' | 'blue' | 'green' | 'gold' | 'purple' | 'teal';

export interface ServerListing {
  code: string;
  name: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  day: number;
  houseName?: string;
  dayStarted: boolean;
  isPublic: boolean;
}

export interface NetPlayerState {
  id: string;
  name: string;
  color: GnomeColorId;
  isHost: boolean;
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
  dismemberMask?: number; // bitmask: 1=leftArm, 2=rightArm, 4=leftLeg, 8=rightLeg, 16=hat
  inCopter?: boolean;
  inCarSeat?: 0 | 1 | 2;
}

export interface NetPropState {
  id: string;
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

export interface NetInsectState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  dead: boolean;
}

export interface NetHumanState {
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

export interface NetCarState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  driverId: string | null;
  passengerId: string | null;
}

export interface NetBossGnomeState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  swipeTimer: number;
  roarTimer: number;
}

export interface NetPetState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  alert: boolean;
  hitTimer: number;
}

export interface NetPetsState {
  dog: NetPetState;
  cat: NetPetState;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: GnomeColorId;
  text: string;
  timestamp: number;
  system?: boolean;
}

export interface MultiplayerHudState {
  active: boolean;
  roomCode: string;
  roomName: string;
  isPublic: boolean;
  isHost: boolean;
  myId: string;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  players: NetPlayerState[];
  chat: ChatMessage[];
}

export interface HudSnapshot {
  day: number;
  house: HouseSummary;
  timeRemaining: number;
  dayDuration: number;
  dayStarted: boolean;
  hp: number;
  maxHp: number;
  stamina: number;
  shinies: number;
  scrap: number;
  upgrades: CraftUpgrades;
  quests: Quest[];
  completedQuestsCount: number;
  minQuestsRequired: number;
  humanAlert: HumanAlertState;
  humanWeapon: HumanWeapon;
  humanDistance: number;
  isHidden: boolean;
  isCrouching: boolean;
  isClimbing: boolean;
  inBurrow: boolean;
  isOutside: boolean;
  isGrabbedByHuman: boolean;
  grabStruggle: number;
  isDowned: boolean;
  respawnTimer: number;
  heldItemName: string | null;
  heldItemWeight: number;
  holdDistance: number;
  inMiniCopter: boolean;
  copterAltitude: number;
  copterSpeed: number;
  hasDrone: boolean;
  inDroneMode: boolean;
  droneBattery: number;
  dismemberMask: number;
  inTreeHub: boolean;
  nearPlayButton: boolean;
  inCarSeat: 0 | 1 | 2;
  carSpeed: number;
  carSeatsUsed: number;
  humanHp: number;
  humanMaxHp: number;
  humanDead: boolean;
  giantGnomeActive: boolean;
  giantGnomeDistance: number;
  dogAlert: boolean;
  catAlert: boolean;
  promptText: string | null;
  pointerLocked: boolean;
  muted: boolean;
  summaryReason: 'extracted' | 'time_up' | 'caught' | 'knocked_out' | null;
  notification: string | null;
  multiplayer: MultiplayerHudState | null;
}
