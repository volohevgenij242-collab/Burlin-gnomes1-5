import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  AABBCollider,
  ChatMessage,
  ClimbableZone,
  CraftUpgrades,
  GameScreen,
  GnomeColorId,
  HideZone,
  HudSnapshot,
  HumanAlertState,
  HumanWeapon,
  InsectEntity,
  InteractiveProp,
  ItemCategory,
  NetBossGnomeState,
  NetCarState,
  NetHumanState,
  NetPetsState,
  NetPlayerState,
  NetPropState,
  Quest,
} from '../types/game';
import { SoundManager } from './audio';
import { getHouseBlueprint, HouseBlueprint } from './houses';
import {
  CatRig,
  createCatModel,
  createDogModel,
  createFirstPersonHandsModel,
  createGiantBossGnomeModel,
  createGiantHumanModel,
  createGnomeCarModel,
  createMavicDroneModel,
  createMiniCopterModel,
  createRemoteGnomePlayerModel,
  createSeveredPartModel,
  DogRig,
  FirstPersonHandsRig,
  GiantBossGnomeRig,
  GNOME_COLOR_PALETTE,
  GnomeCarRig,
  HumanRig,
  MavicDroneRig,
  MiniCopterRig,
  RemoteGnomeRig,
  SeveredPartKind,
} from './models';
import { MultiplayerClient, RoomJoinedPayload, ServerEvent } from './multiplayer';
import { generateDailyQuests } from './quests';
import {
  createStylizedSkyDome,
  createSunbeamDustMotes,
  StylizedSkyDomeUniforms,
  UE5PostColorShader,
} from './stylizedShader';
import { createProceduralTextures, TextureLibrary } from './textures';
import { buildHouseWorld, BuiltWorld } from './worldBuilder';

const PLAYER_RADIUS = 0.42;
const STAND_HEIGHT = 1.5;
const STAND_EYE = 1.32;
const CROUCH_HEIGHT = 0.78;
const CROUCH_EYE = 0.62;
const GRAVITY = 42.0;
const DAY_DURATION = 240; // 4 minutes

// Scratch math objects to avoid per-frame allocations
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

interface ParticleBurst {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

interface BulletTracer {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  damage: number;
}

interface SeveredPartBody {
  mesh: THREE.Group;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
}

interface RemoteAvatarEntry {
  rig: RemoteGnomeRig;
  targetPos: THREE.Vector3;
  curPos: THREE.Vector3;
  targetYaw: number;
  curYaw: number;
  walkPhase: number;
  swingTimer: number;
  wasSwinging: boolean;
}

export class GameEngine {
  private container: HTMLElement;
  private onHudUpdate: (hud: HudSnapshot) => void;
  private onScreenRequest: (screen: GameScreen) => void;

  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private colorGradePass: ShaderPass | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private hemiLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  private chandelierLight!: THREE.PointLight;
  private skyDomeUniforms!: StylizedSkyDomeUniforms;
  private textures!: TextureLibrary;
  private world!: BuiltWorld;
  private sound = new SoundManager();
  private globalAnimatedUniforms: Array<{ uTime: { value: number } }> = [];
  private animatedShaderUniforms: Array<{ uTime: { value: number } }> = [];

  private isSoftwareGl = false;
  private frameId = 0;
  private lastTime = 0;
  private disposed = false;
  private currentFov = 72;

  // Screen & Loop state
  private screen: GameScreen = 'title';
  private pointerLocked = false;
  private pointerLockGraceTimer = 0;
  private isMouseDragging = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private keys: Record<string, boolean> = {};
  private titleTime = 0;
  private hitstopTimer = 0;
  private hudEmitTimer = 0;

  // Player state
  private playerPos = new THREE.Vector3(-17, 0, 36.8);
  private playerVel = new THREE.Vector3();
  private yaw = 0; // Facing North (-Z) toward burrow exit / High-Gnome
  private pitch = 0;
  private currentEyeHeight = STAND_EYE;
  private isGrounded = true;
  private isCrouching = false;
  private crouchToggle = false;
  private isClimbing = false;
  private activeClimb: ClimbableZone | null = null;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private hp = 100;
  private maxHp = 100;
  private stamina = 100;
  private hurtCooldown = 0;
  private stepTimer = 0;
  private cameraShake = 0;

  // Progression & Quests
  private day = 1;
  private dayStarted = false;
  private timeRemaining = DAY_DURATION;
  private shinies = 20; // Starting pocket change so player can test crafting quickly after 1-2 items
  private scrap = 1;
  private upgrades: CraftUpgrades = { stick: false, gloves: false, boots: false, drone: false };
  private garageDronePicked = false;
  private quests: Quest[] = [];
  private summaryReason: HudSnapshot['summaryReason'] = null;
  private notification: string | null = null;
  private notificationTimer = 0;

  // Held Item & First-Person Hands Viewmodel
  private heldProp: InteractiveProp | null = null;
  private holdDistance = 2.4;
  private hands!: FirstPersonHandsRig;
  private stickSwingTimer = 0;
  private stickCooldown = 0;
  private grabReachTimer = 0;

  // Garage Mini-Copter, Mavic Drone & Dismemberment
  private miniCopter!: MiniCopterRig;
  private copterPos = new THREE.Vector3(108.5, 0, 26);
  private copterVel = new THREE.Vector3();
  private copterYaw = Math.PI;
  private copterRotorSpin = 0;
  private inMiniCopter = false;
  private copterCargo: InteractiveProp | null = null;

  private mavicDrone!: MavicDroneRig;
  private dronePos = new THREE.Vector3();
  private droneVel = new THREE.Vector3();
  private droneYaw = 0;
  private dronePitch = 0;
  private inDroneMode = false;
  private droneBattery = 100;
  private droneCargo: InteractiveProp | null = null;
  private dronePulseCooldown = 0;
  private vehicleAudioTimer = 0;

  private dismemberMask = 0;
  private severedParts: SeveredPartBody[] = [];

  // Tree with Eyes Hub ("Дерево с глазами")
  private inTreeHub = true;
  private nearPlayButton = false;
  private treeBlinkTimer = 3.2;
  private treeBlinkProgress = 0;

  // Two-Seater Gnome Car ("Машинка на двоих")
  private gnomeCar!: GnomeCarRig;
  private carPos = new THREE.Vector3(108.5, 0, 54);
  private carTargetPos = new THREE.Vector3(108.5, 0, 54);
  private carYaw = -0.25;
  private carTargetYaw = -0.25;
  private carSpeed = 0;
  private carSteer = 0;
  private carDriverId: string | null = null;
  private carPassengerId: string | null = null;
  private inCarSeat: 0 | 1 | 2 = 0;
  private carHornCooldown = 0;
  private carSyncTimer = 0;

  // Procedural Camera & NPC Animation States
  private elapsedTime = 0;
  private bobPhase = 0;
  private bobBlend = 0;
  private bobRoll = 0;
  private landingDip = 0;
  private wasGrounded = true;
  private prevVelY = 0;
  private highGnomeGestureTimer = 0;

  // Giant Human AI, Killable HP, Weapons & Grab-Throw
  private human!: HumanRig;
  private humanPos = new THREE.Vector3(5, 0, -16);
  private humanYaw = 0;
  private humanTargetPos = new THREE.Vector3(5, 0, -16);
  private humanTargetYaw = 0;
  private humanHp = 120;
  private humanMaxHp = 120;
  private humanDead = false;
  private humanDeathFall = 0;
  private humanWaypointIdx = 0;
  private humanAlert: HumanAlertState = 'patrol';
  private humanWeapon: HumanWeapon = 'broom';
  private humanWeaponTimer = 0;
  private humanShootCooldown = 0;
  private humanAimTimer = 0;
  private humanRecoilTimer = 0;
  private humanMuzzleTimer = 0;
  private humanGrabState: 'none' | 'carrying' | 'winding_up' = 'none';
  private humanGrabTimer = 0;
  private humanGrabTargetId: string | null = null;
  private humanCarryPath: THREE.Vector3[] = [];
  private humanCarryIdx = 0;
  private humanPorchPauseTimer = 0;
  private grabStruggle = 0;
  private humanRemoteAiming = false;
  private humanSuspicion = 0;
  private humanLostSightTimer = 0;
  private humanLastKnownPos = new THREE.Vector3();
  private humanWalkPhase = 0;
  private humanLastStepHalf = 0;
  private humanAttackCooldown = 0;
  private humanStartleTimer = 0;
  private humanSwipeTimer = 0;

  // Giant Boss Gnome ("Большой гном")
  private giantBossGnome!: GiantBossGnomeRig;
  private bossActive = false;
  private bossPos = new THREE.Vector3(-42, 0, 58);
  private bossTargetPos = new THREE.Vector3(-42, 0, 58);
  private bossYaw = 0;
  private bossTargetYaw = 0;
  private bossWalkPhase = 0;
  private bossLastStepHalf = 0;
  private bossSwipeTimer = 0;
  private bossRoarTimer = 0;
  private bossAttackCooldown = 0;
  private bossSpawnTimer = 0;

  // Yard Guard Dog & House Cat
  private yardDog!: DogRig;
  private dogPos = new THREE.Vector3(23, 0, 56);
  private dogTargetPos = new THREE.Vector3(23, 0, 56);
  private dogPatrolTarget = new THREE.Vector3(23, 0, 56);
  private dogYaw = 0;
  private dogTargetYaw = 0;
  private dogWalkPhase = 0;
  private dogAlert = false;
  private dogAttackCooldown = 0;
  private dogStunTimer = 0;
  private dogBarkTimer = 0;

  private houseCat!: CatRig;
  private catPos = new THREE.Vector3(32, 0, 4);
  private catTargetPos = new THREE.Vector3(32, 0, 4);
  private catPatrolTarget = new THREE.Vector3(32, 0, 4);
  private catYaw = 0;
  private catTargetYaw = 0;
  private catWalkPhase = 0;
  private catAlert = false;
  private catAttackCooldown = 0;
  private catStunTimer = 0;
  private catMeowTimer = 0;

  // Multiplayer State
  private mpClient!: MultiplayerClient;
  private mpActive = false;
  private mpRoomCode = '';
  private mpRoomName = '';
  private mpIsPublic = true;
  private mpIsHost = false;
  private mpMyId = '';
  private mpConnectionStatus: 'connected' | 'reconnecting' | 'disconnected' = 'disconnected';
  private mpPlayers = new Map<string, NetPlayerState>();
  private mpChat: ChatMessage[] = [];
  private remoteAvatars = new Map<string, RemoteAvatarEntry>();
  private mpPlayerSyncTimer = 0;
  private mpWorldSyncTimer = 0;
  private mpPropMoveTimer = 0;
  private pendingJoinResolve: (() => void) | null = null;
  private pendingJoinReject: ((err: Error) => void) | null = null;
  private isDowned = false;
  private respawnTimer = 0;
  private chatInputActive = false;

  // Pooled particles & projectiles
  private particles: ParticleBurst[] = [];
  private bullets: BulletTracer[] = [];
  private shardGeo = new THREE.DodecahedronGeometry(0.12, 0);
  private bulletGeo = new THREE.SphereGeometry(0.16, 6, 6);
  private bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd257 });
  private shardMat = new THREE.MeshStandardMaterial({ color: 0xe3dacb, roughness: 0.35 });
  private sparkMat = new THREE.MeshStandardMaterial({ color: 0xf2b144, emissive: 0xd97d1c, emissiveIntensity: 0.6, roughness: 0.4 });
  private dustMat = new THREE.MeshStandardMaterial({ color: 0xbcae98, roughness: 0.95 });

  // Listeners cleanup
  private cleanupFns: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    onHudUpdate: (hud: HudSnapshot) => void,
    onScreenRequest: (screen: GameScreen) => void
  ) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.onScreenRequest = onScreenRequest;

    this.initRendererAndScene();
    this.quests = generateDailyQuests(this.day);
    const initialHouse = getHouseBlueprint(this.day);
    this.world = buildHouseWorld(this.scene, this.textures, initialHouse, this.quests);
    this.animatedShaderUniforms = [...this.globalAnimatedUniforms, ...this.world.animatedUniforms];
    this.human = createGiantHumanModel(this.textures);
    this.humanPos.copy(this.world.patrolWaypoints[0]);
    this.human.group.position.copy(this.humanPos);
    this.scene.add(this.human.group);
    this.applyHouseAtmosphere(initialHouse);

    this.hands = createFirstPersonHandsModel();
    this.camera.add(this.hands.root);

    this.miniCopter = createMiniCopterModel(this.textures);
    this.copterPos.copy(this.world.garageCopterPos);
    this.miniCopter.group.position.copy(this.copterPos);
    this.scene.add(this.miniCopter.group);

    this.mavicDrone = createMavicDroneModel();
    this.mavicDrone.group.visible = false;
    this.scene.add(this.mavicDrone.group);

    this.gnomeCar = createGnomeCarModel(this.textures);
    this.carPos.copy(this.world.carSpawnPos);
    this.gnomeCar.group.position.copy(this.carPos);
    this.scene.add(this.gnomeCar.group);

    this.giantBossGnome = createGiantBossGnomeModel(this.textures);
    this.giantBossGnome.group.visible = false;
    this.scene.add(this.giantBossGnome.group);

    this.yardDog = createDogModel(this.textures);
    this.dogPos.copy(this.world.dogSpawnPos);
    this.yardDog.group.position.copy(this.dogPos);
    this.scene.add(this.yardDog.group);

    this.houseCat = createCatModel(this.textures);
    this.catPos.copy(this.world.catSpawnPos);
    this.houseCat.group.position.copy(this.catPos);
    this.scene.add(this.houseCat.group);

    this.resetWorldEntities();
    this.resetPlayerToBurrow();

    this.mpClient = new MultiplayerClient(
      (ev) => this.handleServerEvent(ev),
      (status) => {
        this.mpConnectionStatus = status;
        this.emitHud();
      }
    );

    this.bindEvents();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.emitHud();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private initRendererAndScene(): void {
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94; // Balanced UE5 Stylized ACES exposure (zero blowouts)
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6daae0);
    this.scene.fog = new THREE.FogExp2(0x28212e, 0.0020);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(72, w / h, 0.12, 340);
    this.scene.add(this.camera);

    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());

    // UE5 Stylized Lumen-inspired Lighting Rig
    const hemi = new THREE.HemisphereLight(0x98ccff, 0x6b4730, 0.62);
    this.hemiLight = hemi;
    this.scene.add(hemi);

    const sunDir = new THREE.DirectionalLight(0xffe1b0, 1.35);
    this.sunLight = sunDir;
    sunDir.position.set(112, 34, 8);
    sunDir.target.position.set(22, 0, -8);
    sunDir.castShadow = !this.isSoftwareGl;
    sunDir.shadow.mapSize.width = 2048;
    sunDir.shadow.mapSize.height = 2048;
    sunDir.shadow.camera.near = 2;
    sunDir.shadow.camera.far = 210;
    sunDir.shadow.camera.left = -78;
    sunDir.shadow.camera.right = 78;
    sunDir.shadow.camera.top = 78;
    sunDir.shadow.camera.bottom = -78;
    sunDir.shadow.bias = -0.0005;
    sunDir.shadow.normalBias = 0.025;
    sunDir.shadow.radius = 2.6;
    this.scene.add(sunDir, sunDir.target);

    // Animated Stylized Sky Dome & Floating Sunbeam Dust Motes
    const skyDome = createStylizedSkyDome(sunDir.position);
    this.skyDomeUniforms = skyDome.uniforms;
    this.scene.add(skyDome.mesh);
    this.globalAnimatedUniforms.push(skyDome.uniforms);

    const dustMotes = createSunbeamDustMotes([
      { min: new THREE.Vector3(64, 1.5, -20), max: new THREE.Vector3(90, 18, 6), count: 70 }, // Wing A sunbeams
      { min: new THREE.Vector3(24, 2.0, -55), max: new THREE.Vector3(48, 17, -34), count: 45 }, // Study window
      { min: new THREE.Vector3(-34, 1.5, -18), max: new THREE.Vector3(6, 17, 18), count: 60 }, // Kitchen / Wing B
      { min: new THREE.Vector3(18, 2.0, -24), max: new THREE.Vector3(52, 18, 18), count: 55 }, // Living room
      { min: new THREE.Vector3(-23, 0.5, 31), max: new THREE.Vector3(-11, 5.5, 41), count: 28 }, // Burrow embers
    ]);
    this.scene.add(dustMotes.points);
    this.globalAnimatedUniforms.push(dustMotes.uniforms);

    // Chandelier warm indoor fill light
    const chandelierLight = new THREE.PointLight(0xffcf94, 1.4, 78, 1.2);
    this.chandelierLight = chandelierLight;
    chandelierLight.position.set(10, 21.2, -2);
    this.scene.add(chandelierLight);

    // Hardware WebGL Post-Processing Stack (Render -> Selective Bloom -> UE5 Color Grade -> ACES Output)
    if (!this.isSoftwareGl) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)), {
        type: THREE.HalfFloatType,
      });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);

      const renderPass = new RenderPass(this.scene, this.camera);
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.24, 0.42, 0.9);
      this.colorGradePass = new ShaderPass(UE5PostColorShader);
      const outputPass = new OutputPass();

      this.composer.addPass(renderPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(this.colorGradePass);
      this.composer.addPass(outputPass);
    }
  }

  private safeRequestPointerLock(): void {
    const canvas = this.renderer?.domElement;
    if (!canvas || document.pointerLockElement === canvas) return;
    try {
      const maybePromise = canvas.requestPointerLock?.() as unknown;
      if (
        maybePromise &&
        typeof (maybePromise as Promise<void>).catch === 'function'
      ) {
        (maybePromise as Promise<void>).catch(() => {
          // Ignore browser iframe / gesture rejection silently
        });
      }
    } catch {
      // Ignore sync pointer-lock exceptions
    }
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;

    const onResize = () => {
      if (this.disposed) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer?.setSize(w, h);
      this.bloomPass?.setSize(w, h);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (this.chatInputActive) {
        return;
      }

      this.keys[e.code] = true;

      if (e.code === 'Space') {
        if (this.screen === 'playing') {
          if (
            !e.repeat &&
            this.humanGrabState === 'carrying' &&
            this.humanGrabTargetId === this.getLocalPlayerId()
          ) {
            this.triggerGrabStruggle();
          } else {
            this.jumpBufferTimer = 0.14;
          }
        }
      }
      if (e.code === 'KeyC' && !e.repeat && this.screen === 'playing') {
        if (!this.inMiniCopter && !this.inDroneMode) {
          this.crouchToggle = !this.crouchToggle;
        }
      }
      if (e.code === 'KeyE' && !e.repeat && this.screen === 'playing') {
        this.handleInteractKey();
      }
      if (e.code === 'KeyF' && !e.repeat && this.screen === 'playing') {
        this.toggleMavicDrone();
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        if (this.screen === 'playing') {
          this.setScreen('paused');
        } else if (this.screen === 'paused' || this.screen === 'workbench' || this.screen === 'highgnome') {
          this.setScreen('playing');
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };

    const onBlur = () => {
      this.isMouseDragging = false;
      Object.keys(this.keys).forEach((k) => {
        this.keys[k] = false;
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      if (this.screen !== 'playing' || this.chatInputActive) return;

      if (document.pointerLockElement === canvas) {
        // Ignore Chromium/iframe pointer-lock acquisition warp spikes
        if (this.pointerLockGraceTimer > 0) return;
        if (Math.abs(e.movementX) > 110 || Math.abs(e.movementY) > 110) return;
        const mx = THREE.MathUtils.clamp(e.movementX, -75, 75);
        const my = THREE.MathUtils.clamp(e.movementY, -75, 75);
        const sens = 0.002;
        this.yaw = normalizeAngle(this.yaw - mx * sens);
        this.pitch = THREE.MathUtils.clamp(this.pitch - my * sens, -1.42, 1.42);
      } else if (this.isMouseDragging) {
        if ((e.buttons & 1) === 0 && (e.buttons & 2) === 0) {
          this.isMouseDragging = false;
          return;
        }
        const dx = THREE.MathUtils.clamp(e.clientX - this.lastDragX, -48, 48);
        const dy = THREE.MathUtils.clamp(e.clientY - this.lastDragY, -48, 48);
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
        const sens = 0.0032;
        this.yaw = normalizeAngle(this.yaw - dx * sens);
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.42, 1.42);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (this.screen !== 'playing') return;
      this.isMouseDragging = true;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;

      if (document.pointerLockElement !== canvas) {
        this.safeRequestPointerLock();
      }
      if (
        e.button === 0 &&
        this.humanGrabState === 'carrying' &&
        this.humanGrabTargetId === this.getLocalPlayerId()
      ) {
        this.triggerGrabStruggle();
        return;
      }
      if (e.button === 0) {
        this.handlePrimaryAction();
      } else if (e.button === 2) {
        this.handleSecondaryAction();
      }
    };

    const onMouseUp = () => {
      this.isMouseDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      if (this.screen !== 'playing' || !this.heldProp) return;
      this.holdDistance = THREE.MathUtils.clamp(this.holdDistance - e.deltaY * 0.002, 1.5, 4.6);
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      this.pointerLocked = locked;
      if (locked) {
        this.pointerLockGraceTimer = 0.18;
        this.isMouseDragging = false;
      } else {
        Object.keys(this.keys).forEach((k) => {
          this.keys[k] = false;
        });
      }
      this.emitHud();
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      this.isMouseDragging = false;
    };

    const onContextRestored = () => {
      if (!this.disposed && !this.isSoftwareGl) {
        this.renderer.compile(this.scene, this.camera);
      }
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this.cleanupFns.push(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    });
  }

  // ==================== PUBLIC CONTROLS FOR REACT UI ====================

  public setChatTyping(typing: boolean): void {
    this.chatInputActive = typing;
    if (typing) {
      Object.keys(this.keys).forEach((k) => {
        this.keys[k] = false;
      });
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock?.();
      }
    } else if (this.screen === 'playing') {
      this.safeRequestPointerLock();
    }
  }

  public sendChatMessage(text: string): void {
    if (!this.mpActive) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.mpClient.send({ type: 'chat:send', text: trimmed });
  }

  private applyHouseAtmosphere(house: HouseBlueprint): void {
    const m = house.mood;
    this.scene.background = new THREE.Color(m.sceneBg);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(m.fogColor);
      this.scene.fog.density = m.fogDensity;
    }

    const sx = house.mirrorX ? -m.sunDir[0] + 56 : m.sunDir[0];
    this.sunLight.position.set(sx, m.sunDir[1], m.sunDir[2]);
    this.sunLight.color.setHex(m.sunColor);
    this.sunLight.intensity = m.sunIntensity;

    this.hemiLight.color.setHex(m.hemiSky);
    this.hemiLight.groundColor.setHex(m.hemiGround);
    this.hemiLight.intensity = m.hemiIntensity;

    this.chandelierLight.position.set(house.mirrorX ? 46 : 10, 21.2, -2);
    this.chandelierLight.color.setHex(m.chandelierColor);
    this.chandelierLight.intensity = m.chandelierIntensity;

    this.skyDomeUniforms.uZenithCol.value.setRGB(m.skyZenith[0], m.skyZenith[1], m.skyZenith[2]);
    this.skyDomeUniforms.uMidCol.value.setRGB(m.skyMid[0], m.skyMid[1], m.skyMid[2]);
    this.skyDomeUniforms.uHorizonCol.value.setRGB(m.skyHorizon[0], m.skyHorizon[1], m.skyHorizon[2]);
    this.skyDomeUniforms.uGroundCol.value.setRGB(m.skyGround[0], m.skyGround[1], m.skyGround[2]);
    this.skyDomeUniforms.uSunDir.value.copy(this.sunLight.position).normalize();

    if (this.human) {
      this.human.shirtMat.color.setHex(house.palette.humanShirt);
      this.human.cardiganMat.color.setHex(house.palette.humanCardigan);
    }
  }

  private rebuildWorldForDay(dayNum: number, quests: Quest[]): void {
    this.heldProp = null;
    if (this.world) {
      this.scene.remove(this.world.worldGroup);
      this.world.worldGroup.traverse((obj) => {
        if (obj.userData?.isOutline) return;
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
    }

    const house = getHouseBlueprint(dayNum);
    this.world = buildHouseWorld(this.scene, this.textures, house, quests);
    this.animatedShaderUniforms = [...this.globalAnimatedUniforms, ...this.world.animatedUniforms];
    this.applyHouseAtmosphere(house);
  }

  public async createMultiplayerServer(params: {
    playerName: string;
    color: GnomeColorId;
    serverName: string;
    isPublic: boolean;
    startDay?: number;
  }): Promise<void> {
    const startDay = Math.max(1, Math.floor(params.startDay ?? 1));
    this.day = startDay;
    this.inTreeHub = true;
    this.quests = generateDailyQuests(startDay);
    this.rebuildWorldForDay(startDay, this.quests);
    this.resetWorldEntities();
    this.resetPlayerToBurrow();

    const initialProps = this.world.props.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      valueShinies: p.valueShinies,
      valueScrap: p.valueScrap,
      x: p.spawnPos.x,
      y: p.spawnPos.y,
      z: p.spawnPos.z,
    }));
    const initialInsects = this.world.insects.map((ins) => ({
      id: ins.id,
      x: ins.homePos.x,
      y: ins.homePos.y,
      z: ins.homePos.z,
      yaw: ins.yaw,
      hp: ins.maxHp,
    }));

    return new Promise<void>((resolve, reject) => {
      this.pendingJoinResolve = resolve;
      this.pendingJoinReject = reject;
      this.mpClient
        .createRoom({
          ...params,
          startDay,
          initialProps,
          initialInsects,
        })
        .catch((err) => {
          this.pendingJoinResolve = null;
          this.pendingJoinReject = null;
          reject(err instanceof Error ? err : new Error('Ошибка создания сервера'));
        });
    });
  }

  public async joinMultiplayerServer(params: {
    code: string;
    playerName: string;
    color: GnomeColorId;
  }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingJoinResolve = resolve;
      this.pendingJoinReject = reject;
      this.mpClient.joinRoom(params).catch((err) => {
        this.pendingJoinResolve = null;
        this.pendingJoinReject = null;
        reject(err instanceof Error ? err : new Error('Ошибка подключения к серверу'));
      });
    });
  }

  public leaveServer(): void {
    this.mpClient.disconnect();
    this.mpActive = false;
    this.mpRoomCode = '';
    this.mpRoomName = '';
    this.mpIsHost = false;
    this.mpMyId = '';
    this.mpPlayers.clear();
    this.mpChat = [];
    this.clearRemoteAvatars();
    this.isDowned = false;
    this.respawnTimer = 0;
    this.inCarSeat = 0;
    this.carDriverId = null;
    this.carPassengerId = null;
    this.bossActive = false;
    this.inTreeHub = true;
    this.setScreen('title');
  }

  public setScreen(next: GameScreen): void {
    this.screen = next;
    this.isMouseDragging = false;
    if (next !== 'playing') {
      Object.keys(this.keys).forEach((k) => {
        this.keys[k] = false;
      });
    } else {
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
    if (next === 'playing' && !this.chatInputActive) {
      this.safeRequestPointerLock();
    } else if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    this.onScreenRequest(next);
    this.emitHud();
  }

  public startNewGame(startDay = 1): void {
    if (this.mpActive) {
      this.leaveServer();
    }
    const cleanDay = Math.max(1, Math.floor(startDay));
    this.day = cleanDay;
    this.shinies = 20;
    this.scrap = 1;
    this.upgrades = { stick: false, gloves: false, boots: false, drone: false };
    this.garageDronePicked = false;
    this.applyUpgradesVisuals();
    this.startDay(cleanDay);
    this.setScreen('playing');
  }

  public startNextDay(): void {
    if (this.mpActive) {
      if (!this.mpIsHost) return;
      const targetDay = this.day + 1;
      const nextQuests = generateDailyQuests(targetDay);
      this.rebuildWorldForDay(targetDay, nextQuests);
      this.mpClient.send({
        type: 'day:next',
        resetProps: this.world.props.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          valueShinies: p.valueShinies,
          valueScrap: p.valueScrap,
          x: p.spawnPos.x,
          y: p.spawnPos.y,
          z: p.spawnPos.z,
        })),
        resetInsects: this.world.insects.map((ins) => ({
          id: ins.id,
          x: ins.homePos.x,
          y: ins.homePos.y,
          z: ins.homePos.z,
          yaw: ins.yaw,
          hp: ins.maxHp,
        })),
      });
      return;
    }
    this.day += 1;
    this.startDay(this.day);
    this.setScreen('playing');
  }

  public retryCurrentDay(): void {
    if (this.mpActive) {
      if (!this.mpIsHost) return;
      const retryQuests = generateDailyQuests(this.day);
      this.rebuildWorldForDay(this.day, retryQuests);
      this.mpClient.send({
        type: 'day:retry',
        resetProps: this.world.props.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          valueShinies: p.valueShinies,
          valueScrap: p.valueScrap,
          x: p.spawnPos.x,
          y: p.spawnPos.y,
          z: p.spawnPos.z,
        })),
        resetInsects: this.world.insects.map((ins) => ({
          id: ins.id,
          x: ins.homePos.x,
          y: ins.homePos.y,
          z: ins.homePos.z,
          yaw: ins.yaw,
          hp: ins.maxHp,
        })),
      });
      return;
    }
    this.startDay(this.day);
    this.setScreen('playing');
  }

  private applyUpgradesVisuals(): void {
    this.hands.stickGroup.visible = this.upgrades.stick && (this.dismemberMask & 2) === 0;
    const gloveHex = this.upgrades.gloves ? 0x3e9c6b : 0xa63329;
    this.hands.leftMittenMat.color.setHex(gloveHex);
    this.hands.rightMittenMat.color.setHex(gloveHex);
    this.hands.leftArm.visible = (this.dismemberMask & 1) === 0;
    this.hands.rightArm.visible = (this.dismemberMask & 2) === 0;
  }

  private startDay(dayNum: number): void {
    this.day = dayNum;
    this.dayStarted = false;
    this.inTreeHub = true;
    this.timeRemaining = DAY_DURATION;
    this.hp = this.maxHp;
    this.stamina = 100;
    this.isDowned = false;
    this.respawnTimer = 0;
    this.summaryReason = null;
    this.quests = generateDailyQuests(dayNum);
    this.rebuildWorldForDay(dayNum, this.quests);
    this.resetWorldEntities();
    this.resetPlayerToBurrow();
    this.showNotification('Ты у Дерева с глазами! Зайди в домик и нажми PLAY [E]!');
  }

  private resetPlayerToBurrow(): void {
    if (this.inTreeHub) {
      this.playerPos.copy(this.world.hubSpawnPos);
    } else {
      this.playerPos.copy(this.world.spawnPos);
    }
    this.playerVel.set(0, 0, 0);
    this.yaw = 0; // Facing North (-Z) toward Tree with Eyes doorway or Burrow exit
    this.pitch = 0;
    this.isCrouching = false;
    this.crouchToggle = false;
    this.isClimbing = false;
    this.heldProp = null;
    this.inMiniCopter = false;
    this.copterCargo = null;
    this.inDroneMode = false;
    this.droneCargo = null;
    this.inCarSeat = 0;
    this.mavicDrone.group.visible = false;
    this.dismemberMask = 0;
    this.applyUpgradesVisuals();
    this.currentEyeHeight = STAND_EYE;
    this.landingDip = 0;
    this.bobBlend = 0;
    this.bobRoll = 0;
    this.wasGrounded = true;
    this.prevVelY = 0;
  }

  private resetWorldEntities(): void {
    this.world.props.forEach((p) => {
      p.collected = false;
      p.broken = false;
      p.tipped = false;
      p.isHeld = false;
      p.velocity.set(0, 0, 0);
      p.angularVelocity.set(0, 0, 0);
      p.mesh.visible = true;
      p.mesh.position.copy(p.spawnPos);
      p.mesh.rotation.set(0, 0, 0);
      if (p.questMarker) p.questMarker.visible = false;
    });

    this.world.insects.forEach((ins) => {
      ins.dead = false;
      ins.hp = ins.maxHp;
      ins.position.copy(ins.homePos);
      ins.mesh.position.copy(ins.homePos);
      ins.mesh.rotation.set(0, ins.yaw, 0);
      ins.bodyGroup.position.set(0, 0, 0);
      ins.bodyGroup.rotation.set(0, 0, 0);
      ins.bodyGroup.scale.set(1, 1, 1);
      ins.mesh.visible = true;
    });

    this.copterPos.copy(this.world.garageCopterPos);
    this.copterVel.set(0, 0, 0);
    this.copterYaw = Math.PI;
    this.copterRotorSpin = 0;
    this.inMiniCopter = false;
    this.copterCargo = null;
    this.miniCopter.group.position.copy(this.copterPos);
    this.miniCopter.group.rotation.set(0, this.copterYaw, 0);
    this.miniCopter.bodyGroup.rotation.set(0, 0, 0);
    this.miniCopter.pilotDecoy.visible = false;
    this.miniCopter.searchLightCone.visible = false;

    this.inDroneMode = false;
    this.droneCargo = null;
    this.droneBattery = 100;
    this.mavicDrone.group.visible = false;
    if (this.world.droneDockMesh) {
      this.world.droneDockMesh.visible = !this.garageDronePicked && !this.upgrades.drone;
    }

    this.severedParts.forEach((sp) => this.scene.remove(sp.mesh));
    this.severedParts = [];

    this.humanPos.copy(this.world.patrolWaypoints[0]);
    this.humanTargetPos.copy(this.humanPos);
    this.humanTargetYaw = 0;
    this.humanHp = 120;
    this.humanMaxHp = 120;
    this.humanDead = false;
    this.humanDeathFall = 0;
    this.humanWaypointIdx = 1;
    this.humanAlert = 'patrol';
    this.humanSuspicion = 0;
    this.humanStartleTimer = 0;
    this.humanSwipeTimer = 0;
    this.humanGrabState = 'none';
    this.humanGrabTimer = 0;
    this.humanGrabTargetId = null;
    this.humanCarryPath = [];
    this.humanCarryIdx = 0;
    this.humanPorchPauseTimer = 0;
    this.grabStruggle = 0;
    this.humanRemoteAiming = false;
    this.humanShootCooldown = 0;
    this.humanAimTimer = 0;
    this.humanRecoilTimer = 0;
    this.humanMuzzleTimer = 0;
    this.setHumanWeapon('broom', true);
    this.human.muzzleFlash.visible = false;
    this.human.alertBadge.visible = false;
    this.human.group.position.copy(this.humanPos);
    this.human.group.rotation.set(0, 0, 0);
    this.human.torsoGroup.rotation.set(0, 0, 0);
    this.human.torsoGroup.position.y = 8.4;

    // Reset Two-Seater Gnome Car
    this.carPos.copy(this.world.carSpawnPos);
    this.carTargetPos.copy(this.world.carSpawnPos);
    this.carYaw = this.world.house.mirrorX ? 0.25 : -0.25;
    this.carTargetYaw = this.carYaw;
    this.carSpeed = 0;
    this.carSteer = 0;
    this.carDriverId = null;
    this.carPassengerId = null;
    this.inCarSeat = 0;
    this.carHornCooldown = 0;
    this.gnomeCar.group.position.copy(this.carPos);
    this.gnomeCar.group.rotation.set(0, this.carYaw, 0);
    this.gnomeCar.bodyGroup.rotation.set(0, 0, 0);
    this.gnomeCar.driverDummy.visible = false;
    this.gnomeCar.passengerDummy.visible = false;

    // Reset Giant Boss Gnome
    const mx = (x: number) => (this.world.house.mirrorX ? 56 - x : x);
    this.bossActive = false;
    this.bossSpawnTimer = 0;
    this.bossPos.set(mx(-42), 0, 58);
    this.bossTargetPos.copy(this.bossPos);
    this.bossYaw = 0;
    this.bossTargetYaw = 0;
    this.bossSwipeTimer = 0;
    this.bossRoarTimer = 0;
    this.bossAttackCooldown = 0;
    this.giantBossGnome.group.visible = false;
    this.giantBossGnome.group.position.copy(this.bossPos);

    // Reset Yard Guard Dog & House Cat
    this.dogPos.copy(this.world.dogSpawnPos);
    this.dogTargetPos.copy(this.dogPos);
    this.dogPatrolTarget.set(mx(38), 0, 58);
    this.dogYaw = 0;
    this.dogTargetYaw = 0;
    this.dogAlert = false;
    this.dogAttackCooldown = 0;
    this.dogStunTimer = 0;
    this.dogBarkTimer = 0;
    this.yardDog.group.position.copy(this.dogPos);
    this.yardDog.group.rotation.set(0, 0, 0);

    this.catPos.copy(this.world.catSpawnPos);
    this.catTargetPos.copy(this.catPos);
    this.catPatrolTarget.set(mx(6), 0, -4);
    this.catYaw = 0;
    this.catTargetYaw = 0;
    this.catAlert = false;
    this.catAttackCooldown = 0;
    this.catStunTimer = 0;
    this.catMeowTimer = 0;
    this.houseCat.group.position.copy(this.catPos);
    this.houseCat.group.rotation.set(0, 0, 0);

    this.bullets.forEach((b) => this.scene.remove(b.mesh));
    this.bullets = [];
  }

  public craftItem(item: keyof CraftUpgrades): boolean {
    if (this.upgrades[item]) return false;
    if (this.mpActive) {
      if (item === 'stick' && this.scrap < 2 && this.shinies < 20) return false;
      if (item === 'gloves' && this.shinies < 35) return false;
      if (item === 'boots' && this.shinies < 45) return false;
      if (item === 'drone' && this.scrap < 2 && this.shinies < 30) return false;
      this.mpClient.send({ type: 'craft:buy', item });
      return true;
    }

    if (item === 'stick') {
      if (this.scrap < 2 && this.shinies < 20) return false;
      if (this.scrap >= 2) this.scrap -= 2;
      else this.shinies -= 20;
      this.upgrades.stick = true;
      this.applyUpgradesVisuals();
      this.sound.playCraft();
      this.showNotification('Скрафчено: Дубинка-палка (ЛКМ для удара)');
    } else if (item === 'gloves') {
      if (this.shinies < 35) return false;
      this.shinies -= 35;
      this.upgrades.gloves = true;
      this.applyUpgradesVisuals();
      this.sound.playCraft();
      this.showNotification('Скрафчено: Перчатки Гномиума (+скорость и карабканье)');
    } else if (item === 'boots') {
      if (this.shinies < 45) return false;
      this.shinies -= 45;
      this.upgrades.boots = true;
      this.sound.playCraft();
      this.showNotification('Скрафчено: Прыгучие ботинки (супер-прыжок!)');
    } else if (item === 'drone') {
      if (this.scrap < 2 && this.shinies < 30) return false;
      if (this.scrap >= 2) this.scrap -= 2;
      else this.shinies -= 30;
      this.upgrades.drone = true;
      this.droneBattery = 100;
      if (this.world.droneDockMesh) this.world.droneDockMesh.visible = false;
      this.sound.playCraft();
      this.showNotification('Скрафчен Мавик-Дрон гномов! Жми [F] для запуска FPV-полёта!');
    }
    this.emitHud();
    return true;
  }

  public extractEarly(): void {
    const done = this.quests.filter((q) => q.completed).length;
    if (done < 3) return;
    if (this.mpActive) {
      if (this.mpIsHost) {
        this.mpClient.send({ type: 'day:extract' });
      }
      return;
    }
    this.finishDay('extracted');
  }

  public toggleMute(): boolean {
    const m = this.sound.toggleMute();
    this.emitHud();
    return m;
  }

  public showNotification(msg: string): void {
    this.notification = msg;
    this.notificationTimer = 3.5;
    this.emitHud();
  }

  // ==================== INTERACTION & COMBAT ====================

  private getTargetedProp(): InteractiveProp | null {
    this.camera.getWorldDirection(_lookDir);
    let best: InteractiveProp | null = null;
    let bestScore = Infinity;

    for (const p of this.world.props) {
      if (p.collected || p.broken || !p.grabbable || p.isHeld) continue;
      _v1.copy(p.mesh.position).sub(this.camera.position);
      const dist = _v1.length();
      if (dist > 5.0 + p.radius) continue;
      _v1.normalize();
      const dot = _v1.dot(_lookDir);
      if (dot > 0.86) {
        const score = dist * (1.2 - dot);
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    return best;
  }

  private handlePrimaryAction(): void {
    if (this.isDowned || this.humanGrabTargetId === this.getLocalPlayerId()) return;

    if (this.inCarSeat === 1) {
      if (this.carHornCooldown <= 0) {
        this.carHornCooldown = 0.65;
        this.sound.playCarHorn();
        if (this.dogPos.distanceTo(this.carPos) < 12) {
          this.dogStunTimer = Math.max(this.dogStunTimer, 1.8);
          this.showNotification('Бип-бип! Собака испугалась сигнала машинки!');
        }
        if (this.catPos.distanceTo(this.carPos) < 12) {
          this.catStunTimer = Math.max(this.catStunTimer, 1.8);
        }
      }
      return;
    }

    if (this.inMiniCopter) {
      this.handleVehicleCargoToggle(true);
      return;
    }
    if (this.inDroneMode) {
      this.handleVehicleCargoToggle(false);
      return;
    }

    if (this.heldProp) {
      // Drop gently
      const p = this.heldProp;
      p.isHeld = false;
      p.velocity.copy(this.playerVel).multiplyScalar(0.4);
      this.heldProp = null;
      this.sound.playGrab();
      if (this.mpActive) {
        this.mpClient.send({
          type: 'prop:release',
          propId: p.id,
          x: p.mesh.position.x,
          y: p.mesh.position.y,
          z: p.mesh.position.z,
          rx: p.mesh.rotation.x,
          ry: p.mesh.rotation.y,
          rz: p.mesh.rotation.z,
          vx: p.velocity.x,
          vy: p.velocity.y,
          vz: p.velocity.z,
        });
      }
      this.emitHud();
      return;
    }

    const target = this.getTargetedProp();
    if (target) {
      this.heldProp = target;
      target.isHeld = true;
      target.velocity.set(0, 0, 0);
      this.grabReachTimer = 0.25;
      this.holdDistance = THREE.MathUtils.clamp(
        this.camera.position.distanceTo(target.mesh.position),
        1.7,
        3.6
      );
      this.sound.playGrab();
      if (this.mpActive) {
        this.mpClient.send({ type: 'prop:grab', propId: target.id });
      }
      this.emitHud();
      return;
    }

    if (this.upgrades.stick && this.stickCooldown <= 0) {
      this.swingStick();
    }
  }

  private handleSecondaryAction(): void {
    if (this.isDowned || this.humanGrabTargetId === this.getLocalPlayerId()) return;

    if (this.inMiniCopter) {
      if (this.copterCargo) {
        const p = this.copterCargo;
        p.isHeld = false;
        p.velocity.copy(this.copterVel).multiplyScalar(0.5);
        this.copterCargo = null;
        this.sound.playThrow();
        if (this.mpActive) {
          this.mpClient.send({
            type: 'prop:release',
            propId: p.id,
            x: p.mesh.position.x,
            y: p.mesh.position.y,
            z: p.mesh.position.z,
            rx: p.mesh.rotation.x,
            ry: p.mesh.rotation.y,
            rz: p.mesh.rotation.z,
            vx: p.velocity.x,
            vy: p.velocity.y,
            vz: p.velocity.z,
          });
        }
        this.emitHud();
      }
      return;
    }

    if (this.inDroneMode) {
      this.fireDroneElectricPulse();
      return;
    }

    if (this.heldProp) {
      this.camera.getWorldDirection(_lookDir);
      const p = this.heldProp;
      p.isHeld = false;
      const throwPower = p.isTrashBin ? 9.5 : 19.5 / Math.sqrt(p.weight);
      p.velocity.copy(_lookDir).multiplyScalar(throwPower);
      p.velocity.y += p.isTrashBin ? 2.5 : 4.2;
      p.angularVelocity.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6
      );
      this.heldProp = null;
      this.grabReachTimer = 0.2;
      this.sound.playThrow();
      if (this.mpActive) {
        this.mpClient.send({
          type: 'prop:release',
          propId: p.id,
          x: p.mesh.position.x,
          y: p.mesh.position.y,
          z: p.mesh.position.z,
          rx: p.mesh.rotation.x,
          ry: p.mesh.rotation.y,
          rz: p.mesh.rotation.z,
          vx: p.velocity.x,
          vy: p.velocity.y,
          vz: p.velocity.z,
        });
      }
      this.emitHud();
      return;
    }

    // Allow RMB to also grab if empty-handed
    const target = this.getTargetedProp();
    if (target) {
      this.heldProp = target;
      target.isHeld = true;
      target.velocity.set(0, 0, 0);
      this.grabReachTimer = 0.25;
      this.holdDistance = 2.4;
      this.sound.playGrab();
      if (this.mpActive) {
        this.mpClient.send({ type: 'prop:grab', propId: target.id });
      }
      this.emitHud();
    }
  }

  private swingStick(): void {
    this.stickSwingTimer = 0.24;
    this.stickCooldown = 0.38;
    this.sound.playStickSwing();

    this.camera.getWorldDirection(_lookDir);
    let hitAny = false;

    for (const ins of this.world.insects) {
      if (ins.dead) continue;
      _v1.copy(ins.position).add(_v2.set(0, 0.3, 0)).sub(this.camera.position);
      const dist = _v1.length();
      if (dist < 3.6) {
        _v1.normalize();
        if (_v1.dot(_lookDir) > 0.55) {
          const knockVx = _lookDir.x * 9;
          const knockVy = 4.5;
          const knockVz = _lookDir.z * 9;

          if (this.mpActive) {
            this.hitstopTimer = 0.045;
            this.cameraShake = 0.12;
            this.sound.playStickHit();
            this.spawnBurst(ins.position, 6, this.sparkMat);
            this.mpClient.send({
              type: 'insect:hit',
              insectId: ins.id,
              damage: 1,
              vx: knockVx,
              vy: knockVy,
              vz: knockVz,
            });
          } else {
            ins.hp -= 1;
            ins.hitFlash = 0.22;
            ins.velocity.set(ins.velocity.x + knockVx, knockVy, ins.velocity.z + knockVz);
            this.hitstopTimer = 0.045;
            this.cameraShake = 0.12;
            this.sound.playStickHit();
            this.spawnBurst(ins.position, 6, this.sparkMat);

            if (ins.hp <= 0) {
              ins.dead = true;
              ins.deathTimer = 1.2;
              this.shinies += 6;
              this.scrap += 1;
              this.spawnSeveredPart('bugLeg', ins.position, _lookDir);
              this.spawnSeveredPart('bugLeg', ins.position, _lookDir);
              this.showNotification('Насекомое повержено! +6 Блестяшек, +1 Хлам');
            } else {
              this.spawnSeveredPart('bugLeg', ins.position, _lookDir);
            }
          }
          hitAny = true;
          break;
        }
      }
    }

    if (!hitAny && !this.inTreeHub) {
      // Hit Neighbor legs / body!
      if (!this.humanDead) {
        const distH = Math.hypot(this.humanPos.x - this.playerPos.x, this.humanPos.z - this.playerPos.z);
        if (distH < 4.4 && this.playerPos.y < 10.0) {
          _v1.set(this.humanPos.x - this.playerPos.x, 0, this.humanPos.z - this.playerPos.z).normalize();
          const lookFlat = _v2.set(_lookDir.x, 0, _lookDir.z).normalize();
          if (_v1.dot(lookFlat) > 0.32 || distH < 2.4) {
            this.hitstopTimer = 0.05;
            this.cameraShake = 0.16;
            this.sound.playStickHit();
            this.spawnBurst(_v3.set(this.humanPos.x, 2.5, this.humanPos.z), 8, this.sparkMat);
            this.damageHuman(18);
            hitAny = true;
          }
        }
      }

      // Whack Yard Dog
      if (!hitAny && this.dogPos.distanceTo(this.playerPos) < 3.6) {
        this.dogStunTimer = 3.0;
        this.dogAlert = false;
        this.hitstopTimer = 0.04;
        this.sound.playStickHit();
        this.sound.playDogBark();
        this.spawnBurst(this.dogPos.clone().setY(1.0), 6, this.sparkMat);
        this.showNotification('Отогнал собаку палкой!');
        hitAny = true;
      }

      // Whack House Cat
      if (!hitAny && this.catPos.distanceTo(this.playerPos) < 3.5) {
        this.catStunTimer = 3.0;
        this.catAlert = false;
        this.hitstopTimer = 0.04;
        this.sound.playStickHit();
        this.sound.playCatMeow();
        this.spawnBurst(this.catPos.clone().setY(0.8), 6, this.sparkMat);
        this.showNotification('Кот в ужасе убежал!');
      }
    }
  }

  public deployFromTreehouse(): void {
    if (!this.inTreeHub || this.screen !== 'playing') return;
    if (this.mpActive) {
      this.mpClient.send({ type: 'hub:play' });
      return;
    }
    this.inTreeHub = false;
    this.dayStarted = true;
    this.playerPos.copy(this.world.houseArrivalPos);
    this.playerVel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.sound.playPlayButton();
    this.showNotification(`Вы прибыли к дому: ${this.world.house.name}! Выполни 3 задания!`);
    this.emitHud();
  }

  private handleInteractKey(): void {
    if (this.isDowned) return;

    if (this.inCarSeat > 0) {
      this.exitGnomeCar();
      return;
    }

    if (this.inTreeHub) {
      if (this.playerPos.distanceTo(this.world.playButtonPos) < 4.5) {
        this.deployFromTreehouse();
      }
      return;
    }

    if (this.inMiniCopter) {
      this.exitMiniCopter();
      return;
    }

    if (!this.inDroneMode && this.playerPos.distanceTo(this.carPos) < 4.5) {
      this.enterGnomeCar();
      return;
    }

    if (!this.inDroneMode && this.playerPos.distanceTo(this.copterPos) < 4.2) {
      this.enterMiniCopter();
      return;
    }

    if (
      !this.inDroneMode &&
      !this.upgrades.drone &&
      !this.garageDronePicked &&
      this.playerPos.distanceTo(this.world.droneDockPos) < 3.8
    ) {
      this.garageDronePicked = true;
      this.droneBattery = 100;
      if (this.world.droneDockMesh) this.world.droneDockMesh.visible = false;
      this.sound.playCraft();
      this.showNotification('Подобран Мавик-Дрон в гараже! Нажми [F] для запуска FPV-разведки!');
      this.emitHud();
      return;
    }

    if (this.playerPos.distanceTo(this.world.workbenchPos) < 3.6) {
      this.setScreen('workbench');
      return;
    }
    if (this.playerPos.distanceTo(this.world.highGnomePos) < 3.6) {
      this.highGnomeGestureTimer = 2.5;
      const done = this.quests.filter((q) => q.completed).length;
      if (done >= 3 && (!this.mpActive || this.mpIsHost)) {
        this.extractEarly();
      } else {
        this.setScreen('highgnome');
      }
      return;
    }
  }

  private getWorldBounds() {
    if (this.inTreeHub) {
      return { minX: -16, maxX: 72, minZ: 106, maxZ: 162 };
    }
    if (this.world?.house?.mirrorX) {
      return { minX: -70, maxX: 95, minZ: -56, maxZ: 73 };
    }
    return { minX: -39, maxX: 126, minZ: -56, maxZ: 73 };
  }

  private enterGnomeCar(): void {
    if (this.inDroneMode) this.toggleMavicDrone();
    if (this.heldProp) {
      this.heldProp.isHeld = false;
      this.heldProp = null;
    }
    this.isClimbing = false;
    this.isCrouching = false;
    this.crouchToggle = false;

    if (this.mpActive) {
      if (this.carDriverId && this.carPassengerId) {
        this.showNotification('Оба места в машинке уже заняты!');
        return;
      }
      this.mpClient.send({ type: 'car:enter' });
      this.sound.playCraft();
      return;
    }

    this.carDriverId = 'local';
    this.inCarSeat = 1;
    this.yaw = this.carYaw;
    this.sound.playCarHorn();
    this.showNotification('Машинка на двоих! WASD езда · Shift турбо · Space тормоз · ЛКМ гудок · E выйти');
    this.emitHud();
  }

  private exitGnomeCar(): void {
    if (this.inCarSeat === 0) return;
    const prevSeat = this.inCarSeat;
    this.inCarSeat = 0;

    if (this.mpActive) {
      this.mpClient.send({ type: 'car:exit' });
    } else {
      if (prevSeat === 1) this.carDriverId = null;
      if (prevSeat === 2) this.carPassengerId = null;
    }

    const sideSign = prevSeat === 1 ? -1 : 1;
    const bounds = this.getWorldBounds();
    this.playerPos.set(
      THREE.MathUtils.clamp(this.carPos.x + Math.cos(this.carYaw) * 2.1 * sideSign, bounds.minX + 1, bounds.maxX - 1),
      0.15,
      THREE.MathUtils.clamp(this.carPos.z - Math.sin(this.carYaw) * 2.1 * sideSign, bounds.minZ + 1, bounds.maxZ - 1)
    );
    this.playerVel.set(0, 0, 0);
    this.isGrounded = true;
    this.emitHud();
  }

  private damageHuman(amount: number): void {
    if (this.humanDead || this.inTreeHub) return;
    if (this.mpActive) {
      this.mpClient.send({ type: 'human:damage', damage: amount });
      return;
    }
    this.humanHp = Math.max(0, this.humanHp - amount);
    if (this.humanHp <= 0) {
      this.humanDead = true;
      this.humanGrabState = 'none';
      this.humanGrabTargetId = null;
      this.humanRemoteAiming = false;
      this.human.muzzleFlash.visible = false;
      this.human.alertBadge.visible = false;
      this.shinies += 45;
      this.scrap += 4;
      this.sound.playHumanDefeat();
      this.spawnBurst(this.humanPos.clone().setY(5.0), 18, this.sparkMat);
      this.bossSpawnTimer = 2.2;
      this.showNotification('СОСЕД ПОВЕРЖЕН! (+45 Блестяшек) Осторожно — за вами идёт БОЛЬШОЙ ГНОМ!');
    } else {
      this.humanStartleTimer = 0.45;
      this.humanAttackCooldown = Math.max(this.humanAttackCooldown, 0.8);
      this.showNotification(`Сосед ранен! (${this.humanHp}/${this.humanMaxHp} HP)`);
    }
    this.emitHud();
  }

  private activateGiantBossGnome(x?: number, y?: number, z?: number): void {
    const mx = (vx: number) => (this.world.house.mirrorX ? 56 - vx : vx);
    this.bossActive = true;
    this.bossPos.set(x ?? mx(-42), y ?? 0, z ?? 58);
    this.bossTargetPos.copy(this.bossPos);
    this.bossYaw = 0;
    this.bossTargetYaw = 0;
    this.bossRoarTimer = 1.6;
    this.bossAttackCooldown = 0.8;
    this.giantBossGnome.group.visible = true;
    this.giantBossGnome.group.position.copy(this.bossPos);
    this.sound.playBossRoar();
    this.cameraShake = Math.max(this.cameraShake, 0.48);
    this.showNotification('БОЛЬШОЙ ГНОМ ворвался во двор мстить за Соседа! Бегите!');
    this.emitHud();
  }

  private enterMiniCopter(): void {
    if (this.inDroneMode) this.toggleMavicDrone();
    if (this.heldProp) {
      this.heldProp.isHeld = false;
      this.heldProp = null;
    }
    this.inMiniCopter = true;
    this.isClimbing = false;
    this.isCrouching = false;
    this.crouchToggle = false;
    this.copterYaw = this.yaw;
    this.sound.playCopterStart(false);
    this.showNotification('Миникоптер гномов! WASD полёт · Space/C высота · Shift турбо · [ЛКМ] магнитный крюк · [E] выйти');
    this.emitHud();
  }

  private exitMiniCopter(): void {
    if (!this.inMiniCopter) return;
    if (this.copterCargo) {
      this.copterCargo.isHeld = false;
      this.copterCargo = null;
    }
    this.inMiniCopter = false;
    const bounds = this.getWorldBounds();
    this.playerPos.set(
      THREE.MathUtils.clamp(this.copterPos.x + Math.cos(this.copterYaw) * 1.6, bounds.minX + 1, bounds.maxX - 1),
      Math.max(0, this.copterPos.y + 0.35),
      THREE.MathUtils.clamp(this.copterPos.z - Math.sin(this.copterYaw) * 1.6, bounds.minZ + 1, bounds.maxZ - 1)
    );
    this.playerVel.set(0, 0, 0);
    this.isGrounded = this.playerPos.y <= 0.1;
    this.emitHud();
  }

  private toggleMavicDrone(): void {
    if (this.isDowned) return;
    if (!(this.upgrades.drone || this.garageDronePicked)) {
      this.showNotification('Найди Мавик-Дрон на зарядке в Гараже или скрафти на Верстаке!');
      return;
    }
    if (this.inMiniCopter) {
      this.showNotification('Сначала выйди из миникоптера [E]!');
      return;
    }
    if (this.inDroneMode) {
      if (this.droneCargo) {
        this.droneCargo.isHeld = false;
        this.droneCargo = null;
      }
      this.inDroneMode = false;
      this.mavicDrone.group.visible = false;
      this.showNotification('Мавик-Дрон вернулся к гному (подзарядка)');
      this.emitHud();
      return;
    }
    if (this.droneBattery < 12) {
      this.showNotification('Батарея дрона разряжена! Подожди немного для подзарядки.');
      return;
    }
    if (this.heldProp) {
      this.heldProp.isHeld = false;
      this.heldProp = null;
    }
    this.inDroneMode = true;
    this.crouchToggle = true;
    this.droneYaw = this.yaw;
    this.dronePitch = this.pitch;
    this.droneVel.set(0, 0, 0);
    this.dronePos.set(
      this.playerPos.x - Math.sin(this.yaw) * 0.9,
      this.playerPos.y + 1.5,
      this.playerPos.z - Math.cos(this.yaw) * 0.9
    );
    this.mavicDrone.group.position.copy(this.dronePos);
    this.mavicDrone.group.visible = true;
    this.sound.playCopterStart(true);
    this.showNotification('Мавик-Дрон запущен! ЛКМ груз · ПКМ электрошокер · Space/C высота · [F] вернуть');
    this.emitHud();
  }

  private handleVehicleCargoToggle(isCopter: boolean): void {
    const activeCargo = isCopter ? this.copterCargo : this.droneCargo;
    const origin = isCopter ? this.copterPos : this.dronePos;

    if (activeCargo) {
      activeCargo.isHeld = false;
      activeCargo.velocity.copy(isCopter ? this.copterVel : this.droneVel).multiplyScalar(0.4);
      if (isCopter) this.copterCargo = null;
      else this.droneCargo = null;
      this.sound.playGrab();
      if (this.mpActive) {
        this.mpClient.send({
          type: 'prop:release',
          propId: activeCargo.id,
          x: activeCargo.mesh.position.x,
          y: activeCargo.mesh.position.y,
          z: activeCargo.mesh.position.z,
          rx: activeCargo.mesh.rotation.x,
          ry: activeCargo.mesh.rotation.y,
          rz: activeCargo.mesh.rotation.z,
          vx: activeCargo.velocity.x,
          vy: activeCargo.velocity.y,
          vz: activeCargo.velocity.z,
        });
      }
      this.emitHud();
      return;
    }

    let best: InteractiveProp | null = null;
    let bestDist = isCopter ? 4.8 : 3.8;
    for (const p of this.world.props) {
      if (p.collected || p.broken || !p.grabbable || p.isHeld || p.isTrashBin) continue;
      if (!isCopter && p.weight > 2.2) continue;
      const d = p.mesh.position.distanceTo(origin);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }

    if (best) {
      best.isHeld = true;
      best.velocity.set(0, 0, 0);
      if (isCopter) this.copterCargo = best;
      else this.droneCargo = best;
      this.sound.playGrab();
      if (this.mpActive) {
        this.mpClient.send({ type: 'prop:grab', propId: best.id });
      }
      this.emitHud();
    } else if (!isCopter) {
      this.showNotification('Подлети ближе к лёгкому предмету для захвата');
    }
  }

  private fireDroneElectricPulse(): void {
    if (this.dronePulseCooldown > 0 || this.droneBattery < 8) return;
    this.dronePulseCooldown = 1.35;
    this.droneBattery = Math.max(0, this.droneBattery - 8);
    this.sound.playDronePulse();
    this.spawnBurst(this.dronePos, 10, this.sparkMat);

    // Zap insects within 4.4 units
    for (const ins of this.world.insects) {
      if (ins.dead) continue;
      if (ins.position.distanceTo(this.dronePos) < 4.4) {
        _v1.copy(ins.position).sub(this.dronePos).normalize();
        const vx = _v1.x * 10;
        const vy = 5.5;
        const vz = _v1.z * 10;
        if (this.mpActive) {
          this.mpClient.send({ type: 'insect:hit', insectId: ins.id, damage: 2, vx, vy, vz });
        } else {
          ins.hp -= 2;
          ins.hitFlash = 0.25;
          ins.velocity.set(vx, vy, vz);
          this.spawnSeveredPart('bugLeg', ins.position, _v1);
          if (ins.hp <= 0) {
            ins.dead = true;
            ins.deathTimer = 1.2;
            this.shinies += 6;
            this.scrap += 1;
            this.showNotification('Дрон поджарил насекомое! +6 Блестяшек, +1 Хлам');
          }
        }
      }
    }

    // Shock, stun & damage Giant Neighbor, Yard Dog & House Cat!
    if (!this.inTreeHub) {
      const distHuman = Math.hypot(this.humanPos.x - this.dronePos.x, this.humanPos.z - this.dronePos.z);
      if (!this.humanDead && distHuman < 8.5 && Math.abs(this.dronePos.y - 12) < 12) {
        this.humanStartleTimer = 1.15;
        this.humanAttackCooldown = Math.max(this.humanAttackCooldown, 2.2);
        this.damageHuman(20);
        this.showNotification('Шокер дрона ударил Соседа (-20 HP)!');
      }
      if (this.dogPos.distanceTo(this.dronePos) < 5.5) {
        this.dogStunTimer = 3.5;
        this.dogAlert = false;
        this.sound.playDogBark();
        this.showNotification('Дрон оглушил собаку!');
      }
      if (this.catPos.distanceTo(this.dronePos) < 5.5) {
        this.catStunTimer = 3.5;
        this.catAlert = false;
        this.sound.playCatMeow();
        this.showNotification('Дрон распугал кота!');
      }
    }
    this.emitHud();
  }

  private getLocalGnomeColor(): GnomeColorId {
    return this.mpPlayers.get(this.mpMyId)?.color ?? 'red';
  }

  private spawnSeveredPart(
    kind: SeveredPartKind,
    origin: THREE.Vector3,
    impulseDir?: THREE.Vector3,
    colorId?: GnomeColorId
  ): void {
    const mesh = createSeveredPartModel(kind, colorId ?? this.getLocalGnomeColor());
    mesh.position.set(
      origin.x + (Math.random() - 0.5) * 0.3,
      Math.max(0.25, origin.y + (kind === 'bugLeg' ? 0.25 : 0.85)),
      origin.z + (Math.random() - 0.5) * 0.3
    );
    this.scene.add(mesh);

    const dirX = impulseDir ? impulseDir.x : Math.random() - 0.5;
    const dirZ = impulseDir ? impulseDir.z : Math.random() - 0.5;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.severedParts.push({
      mesh,
      vel: new THREE.Vector3(
        (dirX / len) * (4 + Math.random() * 5) + (Math.random() - 0.5) * 3,
        4.5 + Math.random() * 5.0,
        (dirZ / len) * (4 + Math.random() * 5) + (Math.random() - 0.5) * 3
      ),
      rotVel: new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      ),
      life: 11.0,
    });
    this.spawnBurst(mesh.position, 6, this.sparkMat);
  }

  private applyRandomDismemberment(heavyHit: boolean, impulseDir?: THREE.Vector3): void {
    const candidates: Array<{ bit: number; kind: SeveredPartKind; label: string }> = [
      { bit: 16, kind: 'hat', label: 'сбило колпак' },
      { bit: 1, kind: 'arm', label: 'оторвало левую руку' },
      { bit: 2, kind: 'arm', label: 'оторвало правую руку' },
      { bit: 4, kind: 'leg', label: 'оторвало левую ногу' },
      { bit: 8, kind: 'leg', label: 'оторвало правую ногу' },
    ];
    const available = candidates.filter((c) => (this.dismemberMask & c.bit) === 0);
    if (available.length === 0) return;

    const count = heavyHit ? Math.min(2, available.length) : 1;
    let lastLabel = '';
    for (let i = 0; i < count; i++) {
      const idx = i === 0 && !heavyHit && available[0].bit === 16 ? 0 : Math.floor(Math.random() * available.length);
      const chosen = available.splice(idx, 1)[0];
      this.dismemberMask |= chosen.bit;
      this.spawnSeveredPart(chosen.kind, this.playerPos, impulseDir);
      lastLabel = chosen.label;
    }

    this.sound.playDismember();
    this.applyUpgradesVisuals();
    if ((this.dismemberMask & 2) !== 0 && this.heldProp) {
      this.heldProp.isHeld = false;
      this.heldProp = null;
    }
    if (lastLabel) {
      this.showNotification(`Ой! Гному ${lastLabel}! Вернись в нору для исцеления!`);
    }
  }

  private spawnBurst(pos: THREE.Vector3, count: number, mat: THREE.Material, isDust = false): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.shardGeo, mat);
      m.position.copy(pos);
      if (isDust) {
        const s = 0.7 + Math.random() * 1.1;
        m.scale.set(s, s, s);
      }
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * (isDust ? 4.5 : 9),
          (isDust ? 1.0 : 2.5) + Math.random() * (isDust ? 2.8 : 6),
          (Math.random() - 0.5) * (isDust ? 4.5 : 9)
        ),
        life: (isDust ? 0.55 : 0.75) + Math.random() * 0.4,
      });
    }
  }

  private recordQuestProgress(category: ItemCategory, typeFilter?: Quest['type']): void {
    let anyCompletedNow = false;
    for (const q of this.quests) {
      if (q.completed) continue;
      if (typeFilter && q.type !== typeFilter) continue;
      if (q.targetCategory === category) {
        q.currentCount += 1;
        if (q.currentCount >= q.requiredCount) {
          q.completed = true;
          this.shinies += q.rewardShinies;
          anyCompletedNow = true;
          this.showNotification(`Задание выполнено: ${q.title} (+${q.rewardShinies} Блестяшек)`);
        }
      }
    }
    if (anyCompletedNow) {
      this.sound.playQuestComplete();
    }
    this.emitHud();
  }

  private finishDay(reason: HudSnapshot['summaryReason']): void {
    this.summaryReason = reason;
    this.heldProp = null;
    this.inCarSeat = 0;
    this.setScreen('summary');
  }

  // ==================== MAIN SIMULATION LOOP ====================

  private loop = (now: number): void => {
    if (this.disposed) return;

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(rawDt, 0.05);

    this.elapsedTime += dt;
    for (let i = 0; i < this.animatedShaderUniforms.length; i++) {
      this.animatedShaderUniforms[i].uTime.value = this.elapsedTime;
    }
    if (this.screen === 'title') {
      this.hands.root.visible = false;
      this.updateTitleCamera(dt);
      this.updateGnomeNpcsAndBurrow(dt);
      this.updateQuestMarkers(dt);
    } else if (this.screen === 'playing') {
      this.hands.root.visible =
        !this.inMiniCopter && !this.inDroneMode && this.inCarSeat !== 1 && !this.isDowned;
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= dt;
      } else {
        this.updatePlaying(dt);
      }
    } else {
      this.hands.root.visible = false;
    }

    if (this.colorGradePass) {
      const uniforms = this.colorGradePass.uniforms;
      uniforms.uTime.value = this.elapsedTime;
      const dangerTarget =
        this.screen !== 'playing'
          ? 0
          : this.humanGrabTargetId === this.getLocalPlayerId() || this.hp <= 28
            ? 1.0
            : this.humanAlert === 'chase'
              ? 0.55
              : 0;
      uniforms.uDanger.value = THREE.MathUtils.damp(uniforms.uDanger.value, dangerTarget, 6, dt);
      const vigTarget = this.screen === 'playing' && this.isCrouching ? 0.52 : 0.24;
      uniforms.uVignette.value = THREE.MathUtils.damp(uniforms.uVignette.value, vigTarget, 8, dt);
    }

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(() => this.loop(performance.now()));
    } else {
      this.frameId = requestAnimationFrame(this.loop);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateTitleCamera(dt: number): void {
    this.titleTime += dt;
    const t = this.titleTime;
    const center = this.world.titleCameraCenter;
    const cx = center.x + Math.sin(t * 0.24) * 7.5;
    const cy = center.y + Math.sin(t * 0.38) * 1.4;
    const cz = center.z + Math.cos(t * 0.2) * 10.5;
    this.camera.position.set(cx, cy, cz);
    const lookBaseX = this.world.house.mirrorX ? 44 : 12;
    const lookX = lookBaseX + Math.sin(t * 0.16) * 16;
    const lookZ = -6 + Math.cos(t * 0.18) * 6;
    this.camera.lookAt(lookX, 4.2, lookZ);
  }

  private updatePlaying(dt: number): void {
    if (this.notificationTimer > 0) {
      this.notificationTimer -= dt;
      if (this.notificationTimer <= 0) this.notification = null;
    }
    if (this.hurtCooldown > 0) this.hurtCooldown -= dt;
    if (this.pointerLockGraceTimer > 0) this.pointerLockGraceTimer = Math.max(0, this.pointerLockGraceTimer - dt);
    if (this.stickCooldown > 0) this.stickCooldown -= dt;
    if (this.stickSwingTimer > 0) this.stickSwingTimer = Math.max(0, this.stickSwingTimer - dt);
    if (this.grabReachTimer > 0) this.grabReachTimer = Math.max(0, this.grabReachTimer - dt);
    if (this.highGnomeGestureTimer > 0) this.highGnomeGestureTimer = Math.max(0, this.highGnomeGestureTimer - dt);
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);

    if (this.carHornCooldown > 0) this.carHornCooldown = Math.max(0, this.carHornCooldown - dt);
    if (this.bossAttackCooldown > 0) this.bossAttackCooldown = Math.max(0, this.bossAttackCooldown - dt);
    if (this.bossSwipeTimer > 0) this.bossSwipeTimer = Math.max(0, this.bossSwipeTimer - dt);
    if (this.bossRoarTimer > 0) this.bossRoarTimer = Math.max(0, this.bossRoarTimer - dt);
    if (this.dogAttackCooldown > 0) this.dogAttackCooldown = Math.max(0, this.dogAttackCooldown - dt);
    if (this.dogStunTimer > 0) this.dogStunTimer = Math.max(0, this.dogStunTimer - dt);
    if (this.dogBarkTimer > 0) this.dogBarkTimer = Math.max(0, this.dogBarkTimer - dt);
    if (this.catAttackCooldown > 0) this.catAttackCooldown = Math.max(0, this.catAttackCooldown - dt);
    if (this.catStunTimer > 0) this.catStunTimer = Math.max(0, this.catStunTimer - dt);
    if (this.catMeowTimer > 0) this.catMeowTimer = Math.max(0, this.catMeowTimer - dt);

    if (this.bossSpawnTimer > 0 && !this.mpActive) {
      this.bossSpawnTimer -= dt;
      if (this.bossSpawnTimer <= 0 && !this.bossActive && !this.inTreeHub) {
        this.activateGiantBossGnome();
      }
    }

    if (this.humanGrabState === 'carrying' && this.humanGrabTargetId === this.getLocalPlayerId()) {
      this.grabStruggle = Math.max(0, this.grabStruggle - dt * 0.14);
    } else {
      this.grabStruggle = 0;
    }

    // Handle multiplayer respawn countdown when downed
    if (this.isDowned) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.isDowned = false;
        this.respawnTimer = 0;
        this.hp = 70;
        this.stamina = 100;
        this.resetPlayerToBurrow();
        this.showNotification('Ты очнулся в норе! Продолжай вылазку!');
      }
    }

    // Arrow key camera look fallback
    if (!this.chatInputActive) {
      const keyLookSpeed = 2.0;
      if (this.keys['ArrowLeft']) this.yaw = normalizeAngle(this.yaw + keyLookSpeed * dt);
      if (this.keys['ArrowRight']) this.yaw = normalizeAngle(this.yaw - keyLookSpeed * dt);
      if (this.keys['ArrowUp']) this.pitch = Math.min(1.4, this.pitch + keyLookSpeed * dt);
      if (this.keys['ArrowDown']) this.pitch = Math.max(-1.4, this.pitch - keyLookSpeed * dt);
    }

    // Check if gnome is inside burrow (only active once deployed from Tree with Eyes Hub)
    const inBurrow = !this.inTreeHub && this.isPointInBurrow(this.playerPos.x, this.playerPos.z);
    if (inBurrow && this.dismemberMask !== 0 && !this.isDowned) {
      this.dismemberMask = 0;
      this.hp = this.maxHp;
      this.applyUpgradesVisuals();
      this.sound.playCraft();
      this.showNotification('Нора исцелила гнома и восстановила оторванные конечности!');
    }
    if (!this.inTreeHub && !inBurrow && !this.dayStarted) {
      this.dayStarted = true;
      if (this.mpActive) {
        this.mpClient.send({ type: 'day:start' });
      }
      this.showNotification('Вылазка началась! Выполни минимум 3 задания и вернись в нору!');
    }

    if (this.dayStarted && !this.inTreeHub && !this.mpActive) {
      this.timeRemaining -= dt;
      if (this.timeRemaining <= 0) {
        this.timeRemaining = 0;
        const done = this.quests.filter((q) => q.completed).length;
        this.finishDay(done >= 3 && inBurrow ? 'extracted' : 'time_up');
        return;
      }
    }

    const isLocallyGrabbed = this.humanGrabState !== 'none' && this.humanGrabTargetId === this.getLocalPlayerId();
    if (this.inCarSeat === 1 && !isLocallyGrabbed && !this.isDowned) {
      this.updateGnomeCarPhysics(dt);
    } else if (this.inCarSeat === 2 && !isLocallyGrabbed && !this.isDowned) {
      this.updateGnomeCarPassive(dt);
      this.gnomeCar.group.updateMatrixWorld(true);
      this.gnomeCar.passengerSlot.getWorldPosition(_v1);
      this.playerPos.set(_v1.x, _v1.y - 0.12, _v1.z);
      this.playerVel.set(0, 0, 0);
    } else if (this.inMiniCopter && !isLocallyGrabbed && !this.isDowned) {
      this.updateMiniCopterPhysics(dt);
      this.updateGnomeCarPassive(dt);
    } else if (this.inDroneMode && !isLocallyGrabbed && !this.isDowned) {
      this.updateMavicDronePhysics(dt);
      this.updateGnomeCarPassive(dt);
    } else if (!isLocallyGrabbed && !this.isDowned) {
      this.updatePlayerPhysics(dt);
      this.updateGnomeCarPassive(dt);
    } else {
      this.updateGnomeCarPassive(dt);
    }

    if (!this.inDroneMode) {
      this.droneBattery = Math.min(100, this.droneBattery + 14 * dt);
    }
    if (this.dronePulseCooldown > 0) this.dronePulseCooldown = Math.max(0, this.dronePulseCooldown - dt);

    // Passive idle rotor coasting when copter parked
    if (!this.inMiniCopter) {
      this.updateParkedMiniCopter(dt);
    }

    this.updateHeldProp(dt);
    this.updateTreeWithEyesHub(dt);

    const simulateWorld = !this.mpActive || this.mpIsHost;
    this.updatePropsPhysics(dt, simulateWorld);
    if (simulateWorld) {
      this.updateHumanAI(dt);
      this.updateInsectsAI(dt);
      this.updateGiantBossGnomeAI(dt);
      this.updateYardDogAI(dt);
      this.updateHouseCatAI(dt);
    } else {
      this.updateHumanClientInterpolated(dt);
      this.updateInsectsClientInterpolated(dt);
      this.updateGiantBossGnomeClientInterpolated(dt);
      this.updatePetsClientInterpolated(dt);
    }

    this.updateBullets(dt);
    this.updateGnomeNpcsAndBurrow(dt);
    this.updateRemoteAvatars(dt);
    this.updateQuestMarkers(dt);
    this.updateParticles(dt);
    this.updateSeveredParts(dt);

    if (this.mpActive) {
      this.syncMultiplayerTick(dt);
    }

    const horizSpeed = Math.hypot(this.playerVel.x, this.playerVel.z);
    const isMoving =
      this.inCarSeat === 0 &&
      !this.inMiniCopter &&
      !this.inDroneMode &&
      this.isGrounded &&
      horizSpeed > 1.2 &&
      !this.isDowned &&
      !isLocallyGrabbed;
    const isSprinting =
      (this.keys['ShiftLeft'] || this.keys['ShiftRight']) && !this.isCrouching && this.stamina > 5 && horizSpeed > 11.2;

    this.updateHeadBobbing(dt, horizSpeed, isMoving, isSprinting);
    this.updateFirstPersonHands(dt, isMoving, isSprinting);

    if (this.inCarSeat === 1) {
      // Smooth chase camera behind 2-seater Gnome Car
      const camDist = 5.0;
      const camHeight = 2.45;
      const camX = this.carPos.x + Math.sin(this.yaw) * camDist;
      const camZ = this.carPos.z + Math.cos(this.yaw) * camDist;
      const bounds = this.getWorldBounds();
      this.camera.position.set(
        THREE.MathUtils.clamp(camX, bounds.minX + 0.5, bounds.maxX - 0.5),
        THREE.MathUtils.clamp(this.carPos.y + camHeight - Math.sin(this.pitch) * 1.9, 0.9, 14.0),
        THREE.MathUtils.clamp(camZ, bounds.minZ + 0.5, bounds.maxZ - 0.5)
      );
      this.camera.lookAt(this.carPos.x, this.carPos.y + 0.85, this.carPos.z);
    } else if (this.inCarSeat === 2) {
      const shakeX = (Math.random() - 0.5) * this.cameraShake;
      const shakeY = (Math.random() - 0.5) * this.cameraShake;
      this.camera.position.set(
        this.playerPos.x + shakeX,
        this.playerPos.y + 0.72 + shakeY,
        this.playerPos.z
      );
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      this.camera.rotation.z = 0;
    } else if (this.inMiniCopter) {
      // Third-person chase camera behind & slightly above Mini-Copter
      const camDist = 5.4;
      const camHeight = 2.4;
      const camX = this.copterPos.x + Math.sin(this.yaw) * camDist;
      const camZ = this.copterPos.z + Math.cos(this.yaw) * camDist;
      const bounds = this.getWorldBounds();
      this.camera.position.set(
        THREE.MathUtils.clamp(camX, bounds.minX + 0.5, bounds.maxX - 0.5),
        THREE.MathUtils.clamp(this.copterPos.y + camHeight - Math.sin(this.pitch) * 2.2, 0.8, 24.5),
        THREE.MathUtils.clamp(camZ, bounds.minZ + 0.5, bounds.maxZ - 0.5)
      );
      this.camera.lookAt(this.copterPos.x, this.copterPos.y + 0.9, this.copterPos.z);
    } else if (this.inDroneMode) {
      // Crisp FPV Drone Camera
      const shakeX = (Math.random() - 0.5) * this.cameraShake * 0.5;
      const shakeY = (Math.random() - 0.5) * this.cameraShake * 0.5;
      this.camera.position.set(this.dronePos.x + shakeX, this.dronePos.y + 0.04 + shakeY, this.dronePos.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      this.camera.rotation.z = -Math.sin(this.mavicDrone.bodyGroup.rotation.z) * 0.35;
    } else {
      // First-person Gnome Camera + Head Bobbing + Limp Roll + Shake
      const bobX = Math.cos(this.bobPhase) * 0.055 * this.bobBlend;
      const bobY = Math.abs(Math.sin(this.bobPhase)) * (isSprinting ? 0.095 : 0.068) * this.bobBlend;
      const missingLegs = ((this.dismemberMask & 4) ? 1 : 0) + ((this.dismemberMask & 8) ? 1 : 0);
      const limpRoll = missingLegs === 1 && isMoving ? Math.sin(this.bobPhase) * 0.055 : 0;
      const shakeX = (Math.random() - 0.5) * this.cameraShake;
      const shakeY = (Math.random() - 0.5) * this.cameraShake;

      _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.camera.position.set(
        this.playerPos.x + _right.x * bobX + shakeX,
        this.playerPos.y + this.currentEyeHeight + bobY - this.landingDip + shakeY,
        this.playerPos.z + _right.z * bobX
      );
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch - this.landingDip * 0.25;
      this.camera.rotation.z = this.bobRoll + limpRoll;
    }

    // Smooth dynamic FOV
    const desiredFov = this.inDroneMode
      ? 84
      : this.inCarSeat === 1
        ? 76 + Math.min(12, Math.abs(this.carSpeed) * 0.45)
        : this.inMiniCopter
          ? 78
          : this.isCrouching
            ? 68
            : isSprinting || (!this.isGrounded && horizSpeed > 13.5)
              ? 78
              : 72;
    this.currentFov = THREE.MathUtils.damp(this.currentFov, desiredFov, 10, dt);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.02) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.hudEmitTimer += dt;
    if (this.hudEmitTimer >= 0.08) {
      this.hudEmitTimer = 0;
      this.emitHud();
    }
  }

  private hasStandClearance(): boolean {
    const px = this.playerPos.x;
    const pz = this.playerPos.z;
    const pyBottom = this.playerPos.y + 0.1;
    const pyTop = this.playerPos.y + STAND_HEIGHT;
    for (const c of this.world.colliders) {
      if (c.isFloorLike) continue;
      if (
        px + PLAYER_RADIUS > c.minX &&
        px - PLAYER_RADIUS < c.maxX &&
        pz + PLAYER_RADIUS > c.minZ &&
        pz - PLAYER_RADIUS < c.maxZ &&
        pyTop > c.minY &&
        pyBottom < c.maxY
      ) {
        return false;
      }
    }
    return true;
  }

  private updatePlayerPhysics(dt: number): void {
    const wantCrouch = this.keys['ControlLeft'] || this.keys['ControlRight'] || this.crouchToggle;
    if (wantCrouch) {
      this.isCrouching = true;
    } else if (this.isCrouching && this.hasStandClearance()) {
      this.isCrouching = false;
    }

    const targetEye = this.isCrouching ? CROUCH_EYE : STAND_EYE;
    this.currentEyeHeight = THREE.MathUtils.damp(this.currentEyeHeight, targetEye, 16, dt);
    const activeHeight = this.isCrouching ? CROUCH_HEIGHT : STAND_HEIGHT;

    // Input direction
    let moveF = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    let moveR = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);

    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Check Climbable Zones
    this.activeClimb = null;
    for (const cz of this.world.climbables) {
      if (
        this.playerPos.x + PLAYER_RADIUS + 0.35 > cz.minX &&
        this.playerPos.x - PLAYER_RADIUS - 0.35 < cz.maxX &&
        this.playerPos.z + PLAYER_RADIUS + 0.35 > cz.minZ &&
        this.playerPos.z - PLAYER_RADIUS - 0.35 < cz.maxZ &&
        this.playerPos.y + activeHeight > cz.minY &&
        this.playerPos.y < cz.maxY
      ) {
        this.activeClimb = cz;
        break;
      }
    }

    const atTopPlatform =
      this.activeClimb !== null &&
      this.isGrounded &&
      this.playerPos.y >= this.activeClimb.maxY - 0.35;
    if (this.activeClimb && !atTopPlatform && (this.keys['KeyW'] || this.keys['Space'])) {
      this.isClimbing = true;
    } else if (!this.activeClimb || atTopPlatform || (this.isGrounded && this.keys['KeyS'])) {
      this.isClimbing = false;
    }

    const wantSprint = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) && !this.isCrouching && this.stamina > 5 && (moveF !== 0 || moveR !== 0);
    if (wantSprint) {
      this.stamina = Math.max(0, this.stamina - 24 * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + 18 * dt);
    }

    let speed = this.isCrouching ? 5.6 : wantSprint ? 15.2 : 10.6;
    if (this.upgrades.gloves) speed *= 1.24;
    const missingLegs = ((this.dismemberMask & 4) ? 1 : 0) + ((this.dismemberMask & 8) ? 1 : 0);
    if (missingLegs === 1) speed *= 0.78;
    else if (missingLegs >= 2) speed *= 0.58;
    if (this.heldProp) {
      const penalty = this.upgrades.gloves ? 0.07 : 0.16;
      speed /= 1 + (this.heldProp.weight - 1) * penalty;
    }

    _v1.set(0, 0, 0);
    _v1.addScaledVector(_forward, moveF).addScaledVector(_right, moveR);
    if (_v1.lengthSq() > 0.001) _v1.normalize();

    if (this.isClimbing && this.activeClimb) {
      const climbSpeed = this.upgrades.gloves ? 11.0 : 7.2;
      let climbY = 0;
      if (this.keys['KeyW'] || this.keys['Space']) climbY = climbSpeed;
      else if (this.keys['KeyS']) climbY = -climbSpeed * 0.8;

      this.playerVel.x = _v1.x * 5.0;
      this.playerVel.z = _v1.z * 5.0;
      this.playerVel.y = climbY;
      this.isGrounded = false;

      if (Math.abs(climbY) > 0.5) {
        this.stepTimer += dt;
        if (this.stepTimer > 0.28) {
          this.stepTimer = 0;
          this.sound.playClimb();
        }
      }
    } else {
      const accel = this.isGrounded ? 18 : 7;
      this.playerVel.x = THREE.MathUtils.damp(this.playerVel.x, _v1.x * speed, accel, dt);
      this.playerVel.z = THREE.MathUtils.damp(this.playerVel.z, _v1.z * speed, accel, dt);

      // Coyote time & jump buffer
      if (this.isGrounded) this.coyoteTimer = 0.12;
      else this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);

      if (this.jumpBufferTimer > 0) this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);

      if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
        const jumpForce = this.upgrades.boots ? 25.2 : 17.5;
        this.playerVel.y = jumpForce;
        this.isGrounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.sound.playJump(this.upgrades.boots);
      }

      this.playerVel.y -= GRAVITY * dt;
    }

    // Move & Collide X, Z, Y
    this.prevVelY = this.playerVel.y;
    this.moveAndCollide(dt, activeHeight);

    // Detect jump landing for camera squat dip
    if (!this.wasGrounded && this.isGrounded && this.prevVelY < -4.0) {
      const impact = THREE.MathUtils.clamp((-this.prevVelY - 4.0) / 22, 0.08, 0.34);
      this.landingDip = Math.max(this.landingDip, impact);
    }
    this.wasGrounded = this.isGrounded;

    // Footstep sound
    const horizSpeed = Math.hypot(this.playerVel.x, this.playerVel.z);
    if (this.isGrounded && horizSpeed > 1.8) {
      this.stepTimer += dt * (horizSpeed / 9);
      if (this.stepTimer > 0.34) {
        this.stepTimer = 0;
        const surface = this.world.isKitchenAt(this.playerPos.x, this.playerPos.z) ? 'tile' : 'wood';
        this.sound.playFootstep(surface, this.isCrouching);
      }
    }
  }

  private moveAndCollide(dt: number, height: number): void {
    const r = PLAYER_RADIUS;

    // Step 1: X axis
    this.playerPos.x += this.playerVel.x * dt;
    for (const c of this.world.colliders) {
      if (c.isFloorLike) continue;
      if (
        this.playerPos.x + r > c.minX &&
        this.playerPos.x - r < c.maxX &&
        this.playerPos.z + r > c.minZ &&
        this.playerPos.z - r < c.maxZ &&
        this.playerPos.y + height > c.minY + 0.05 &&
        this.playerPos.y < c.maxY - 0.05
      ) {
        // Automatic small step-up for rugs/books & top of climbable chairs/tables
        if (c.maxY - this.playerPos.y <= 0.58 && (this.isGrounded || this.isClimbing)) {
          this.playerPos.y = c.maxY;
        } else {
          if (this.playerVel.x > 0) this.playerPos.x = c.minX - r;
          else if (this.playerVel.x < 0) this.playerPos.x = c.maxX + r;
          this.playerVel.x = 0;
        }
      }
    }

    // Step 2: Z axis
    this.playerPos.z += this.playerVel.z * dt;
    for (const c of this.world.colliders) {
      if (c.isFloorLike) continue;
      if (
        this.playerPos.x + r > c.minX &&
        this.playerPos.x - r < c.maxX &&
        this.playerPos.z + r > c.minZ &&
        this.playerPos.z - r < c.maxZ &&
        this.playerPos.y + height > c.minY + 0.05 &&
        this.playerPos.y < c.maxY - 0.05
      ) {
        if (c.maxY - this.playerPos.y <= 0.58 && (this.isGrounded || this.isClimbing)) {
          this.playerPos.y = c.maxY;
        } else {
          if (this.playerVel.z > 0) this.playerPos.z = c.minZ - r;
          else if (this.playerVel.z < 0) this.playerPos.z = c.maxZ + r;
          this.playerVel.z = 0;
        }
      }
    }

    // Step 3: Y axis
    this.playerPos.y += this.playerVel.y * dt;
    this.isGrounded = false;
    for (const c of this.world.colliders) {
      if (
        this.playerPos.x + r > c.minX &&
        this.playerPos.x - r < c.maxX &&
        this.playerPos.z + r > c.minZ &&
        this.playerPos.z - r < c.maxZ &&
        this.playerPos.y + height > c.minY &&
        this.playerPos.y < c.maxY
      ) {
        if (this.playerVel.y <= 0) {
          this.playerPos.y = c.maxY;
          this.playerVel.y = 0;
          this.isGrounded = true;
        } else {
          this.playerPos.y = c.minY - height;
          this.playerVel.y = 0;
        }
      }
    }

    if (this.playerPos.y < 0) {
      this.playerPos.y = 0;
      this.playerVel.y = 0;
      this.isGrounded = true;
    }
    const bounds = this.getWorldBounds();
    this.playerPos.x = THREE.MathUtils.clamp(this.playerPos.x, bounds.minX, bounds.maxX);
    this.playerPos.z = THREE.MathUtils.clamp(this.playerPos.z, bounds.minZ, bounds.maxZ);
  }

  private updateHeldProp(dt: number): void {
    const bounds = this.getWorldBounds();
    const minHouseX = bounds.minX + 0.8;
    const maxHouseX = bounds.maxX - 0.8;

    // Also update Mini-Copter & Mavic Drone attached cargo!
    if (this.copterCargo) {
      const p = this.copterCargo;
      this.miniCopter.group.updateMatrixWorld(true);
      this.miniCopter.hookAnchor.getWorldPosition(_v1);
      _v1.y = Math.max(p.halfHeight + 0.05, _v1.y - p.halfHeight - 0.12);
      p.mesh.position.lerp(_v1, 1 - Math.exp(-16 * dt));
      p.mesh.rotation.y += dt * 0.6;
    }
    if (this.droneCargo) {
      const p = this.droneCargo;
      this.mavicDrone.group.updateMatrixWorld(true);
      this.mavicDrone.clawAnchor.getWorldPosition(_v1);
      _v1.y = Math.max(p.halfHeight + 0.04, _v1.y - p.halfHeight - 0.06);
      p.mesh.position.lerp(_v1, 1 - Math.exp(-18 * dt));
      p.mesh.rotation.y += dt * 0.8;
    }

    if (!this.heldProp) return;
    const p = this.heldProp;
    this.camera.getWorldDirection(_lookDir);

    if (p.isTrashBin) {
      // Heavy trash bin is dragged & tilted!
      _v1.copy(this.playerPos).addScaledVector(_lookDir, this.holdDistance + 1.1);
      _v1.y = Math.max(p.halfHeight, this.playerPos.y + 1.2);
      p.mesh.position.lerp(_v1, 1 - Math.exp(-8 * dt));
      p.mesh.rotation.z = THREE.MathUtils.damp(p.mesh.rotation.z, 0.78, 4, dt);
      if (!p.tipped && Math.abs(p.mesh.rotation.z) > 0.65) {
        p.tipped = true;
        this.sound.playTrashCrash();
        this.cameraShake = 0.2;
        this.spawnBurst(p.mesh.position, 10, this.shardMat);
        if (this.mpActive) {
          this.mpClient.send({
            type: 'prop:tip',
            propId: p.id,
            x: p.mesh.position.x,
            y: p.mesh.position.y,
            z: p.mesh.position.z,
          });
        } else {
          this.recordQuestProgress('trashbin', 'vandalism');
        }
      }
      return;
    }

    _v1.copy(this.camera.position).addScaledVector(_lookDir, this.holdDistance);
    _v1.y = Math.max(p.halfHeight + 0.05, _v1.y);
    _v1.x = THREE.MathUtils.clamp(_v1.x, minHouseX, maxHouseX);
    _v1.z = THREE.MathUtils.clamp(_v1.z, -55.2, 72.5);

    const k = p.weight > 1.5 ? 11 : 18;
    p.mesh.position.lerp(_v1, 1 - Math.exp(-k * dt));
    p.mesh.rotation.y += dt * 0.4;
  }

  private updatePropsPhysics(dt: number, simulateUnheld: boolean): void {
    const bounds = this.getWorldBounds();
    const minHouseX = bounds.minX + 0.8;
    const maxHouseX = bounds.maxX - 0.8;
    for (const p of this.world.props) {
      if (p.collected || p.broken) continue;

      if (p.isHeld) {
        // Check delivery even while held by local player, Mini-Copter, or Mavic Drone
        if (
          (this.heldProp === p || this.copterCargo === p || this.droneCargo === p) &&
          !p.isTrashBin
        ) {
          const distToStash = Math.hypot(
            p.mesh.position.x - this.world.stashCenter.x,
            p.mesh.position.z - this.world.stashCenter.z
          );
          if (distToStash < this.world.stashRadius && p.mesh.position.y < 2.2) {
            if (this.heldProp === p) this.heldProp = null;
            if (this.copterCargo === p) this.copterCargo = null;
            if (this.droneCargo === p) this.droneCargo = null;
            p.isHeld = false;
            p.collected = true;
            p.mesh.visible = false;
            if (this.mpActive) {
              this.mpClient.send({ type: 'prop:collect', propId: p.id });
            } else {
              this.shinies += p.valueShinies;
              this.scrap += p.valueScrap;
              this.sound.playCraft();
              this.spawnBurst(this.world.stashCenter.clone().setY(0.8), 8, this.sparkMat);
              this.showNotification(`Добыча сдана: ${p.name} (+${p.valueShinies} Блестяшек)`);
              this.recordQuestProgress(p.category);
            }
          }
        }
        continue;
      }

      if (!simulateUnheld) continue;

      // Gravity & motion for thrown/falling props
      if (p.mesh.position.y > p.halfHeight + 0.02 || p.velocity.lengthSq() > 0.001) {
        p.velocity.y -= GRAVITY * 0.85 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.rotation.x += p.angularVelocity.x * dt;
        p.mesh.rotation.y += p.angularVelocity.y * dt;
        p.mesh.rotation.z += p.angularVelocity.z * dt;

        // Room & yard bounds
        p.mesh.position.x = THREE.MathUtils.clamp(p.mesh.position.x, minHouseX, maxHouseX);
        p.mesh.position.z = THREE.MathUtils.clamp(p.mesh.position.z, -55.2, 72.5);

        // Thrown heavy/fast prop hitting Neighbor deals damage!
        if (!this.humanDead && !this.inTreeHub && p.velocity.lengthSq() > 64 && p.mesh.position.y < 14) {
          const distToHuman = Math.hypot(p.mesh.position.x - this.humanPos.x, p.mesh.position.z - this.humanPos.z);
          if (distToHuman < 2.4) {
            p.velocity.multiplyScalar(-0.4);
            p.velocity.y = Math.max(2.5, Math.abs(p.velocity.y));
            this.sound.playStickHit();
            this.spawnBurst(p.mesh.position, 8, this.sparkMat);
            this.damageHuman(15);
          }
        }

        // Find highest floor/collider surface directly under prop
        let floorY = 0;
        for (const c of this.world.colliders) {
          if (c.isFloorLike) continue;
          if (
            p.mesh.position.x > c.minX - p.radius * 0.4 &&
            p.mesh.position.x < c.maxX + p.radius * 0.4 &&
            p.mesh.position.z > c.minZ - p.radius * 0.4 &&
            p.mesh.position.z < c.maxZ + p.radius * 0.4 &&
            p.mesh.position.y >= c.maxY - 0.35
          ) {
            if (c.maxY > floorY) floorY = c.maxY;
          }
        }

        if (p.mesh.position.y <= floorY + p.halfHeight) {
          const impactSpeed = Math.abs(p.velocity.y) + Math.hypot(p.velocity.x, p.velocity.z) * 0.5;
          p.mesh.position.y = floorY + p.halfHeight;

          if (p.breakable && !p.broken && impactSpeed > 8.5) {
            p.broken = true;
            p.mesh.visible = false;
            if (p.questMarker) p.questMarker.visible = false;
            this.sound.playShatter();
            this.cameraShake = 0.16;
            this.spawnBurst(p.mesh.position, 14, this.shardMat);
            this.spawnBurst(p.mesh.position, 6, this.dustMat, true);
            if (this.mpActive) {
              this.mpClient.send({
                type: 'prop:break',
                propId: p.id,
                x: p.mesh.position.x,
                y: p.mesh.position.y,
                z: p.mesh.position.z,
              });
            } else {
              this.recordQuestProgress(p.category, 'vandalism');
            }
            continue;
          }

          if (p.isTrashBin && !p.tipped && impactSpeed > 4.5) {
            p.tipped = true;
            p.mesh.rotation.z = Math.PI / 2;
            this.sound.playTrashCrash();
            this.spawnBurst(p.mesh.position, 10, this.dustMat, true);
            if (this.mpActive) {
              this.mpClient.send({
                type: 'prop:tip',
                propId: p.id,
                x: p.mesh.position.x,
                y: p.mesh.position.y,
                z: p.mesh.position.z,
              });
            } else {
              this.recordQuestProgress('trashbin', 'vandalism');
            }
          } else if (impactSpeed > 5.0) {
            this.spawnBurst(p.mesh.position, 5, this.dustMat, true);
          }

          p.velocity.y = -p.velocity.y * 0.22;
          p.velocity.x *= 0.45;
          p.velocity.z *= 0.45;
          p.angularVelocity.multiplyScalar(0.3);
          if (Math.abs(p.velocity.y) < 0.8) p.velocity.y = 0;
          if (p.velocity.lengthSq() < 0.08) {
            p.velocity.set(0, 0, 0);
            p.angularVelocity.set(0, 0, 0);
          }
        }
      }

      // Check delivery onto Burrow Stash Mat
      if (!p.isTrashBin) {
        const distToStash = Math.hypot(
          p.mesh.position.x - this.world.stashCenter.x,
          p.mesh.position.z - this.world.stashCenter.z
        );
        if (distToStash < this.world.stashRadius && p.mesh.position.y < 2.2) {
          p.collected = true;
          p.mesh.visible = false;
          if (this.mpActive) {
            this.mpClient.send({ type: 'prop:collect', propId: p.id });
          } else {
            this.shinies += p.valueShinies;
            this.scrap += p.valueScrap;
            this.sound.playCraft();
            this.spawnBurst(this.world.stashCenter.clone().setY(0.8), 8, this.sparkMat);
            this.showNotification(`Добыча сдана: ${p.name} (+${p.valueShinies} Блестяшек)`);
            this.recordQuestProgress(p.category);
          }
        }
      }
    }
  }

  private isPointInBurrow(x: number, z: number): boolean {
    return (
      x >= this.world.burrowBounds.minX &&
      x <= this.world.burrowBounds.maxX &&
      z >= this.world.burrowBounds.minZ &&
      z <= this.world.burrowBounds.maxZ
    );
  }

  private isPointInHideZone(x: number, y: number, z: number): HideZone | null {
    for (const hz of this.world.hideZones) {
      if (x >= hz.minX && x <= hz.maxX && y >= hz.minY && y <= hz.maxY && z >= hz.minZ && z <= hz.maxZ) {
        return hz;
      }
    }
    return null;
  }

  private getCurrentHideZone(): HideZone | null {
    return this.isPointInHideZone(this.playerPos.x, this.playerPos.y, this.playerPos.z);
  }

  private setHumanWeapon(next: HumanWeapon, silent = false): void {
    if (this.humanWeapon === next && !silent) return;
    this.humanWeapon = next;
    this.human.broomGroup.visible = next === 'broom';
    this.human.revolverGroup.visible = next === 'revolver';
    this.human.rifleGroup.visible = next === 'rifle';
    this.human.shotgunGroup.visible = next === 'shotgun';
    this.human.muzzleFlash.position.y =
      next === 'revolver' ? -7.9 : next === 'rifle' ? -11.0 : -10.0;

    if (next !== 'broom' && !silent) {
      this.humanAimTimer = 0.6;
      this.sound.playWeaponDraw();
      const label =
        next === 'revolver'
          ? 'Сосед достал револьвер!'
          : next === 'rifle'
            ? 'Сосед достал винтовку!'
            : 'Сосед достал дробовик!';
      this.showNotification(label);
    }
  }

  private getLocalPlayerId(): string {
    return this.mpActive ? this.mpMyId : 'local';
  }

  private getAlivePlayerTargets(): Array<{
    id: string;
    pos: THREE.Vector3;
    eyeHeight: number;
    isCrouching: boolean;
    isHidden: boolean;
    isOutside: boolean;
    inBurrow: boolean;
  }> {
    const targets: Array<{
      id: string;
      pos: THREE.Vector3;
      eyeHeight: number;
      isCrouching: boolean;
      isHidden: boolean;
      isOutside: boolean;
      inBurrow: boolean;
    }> = [];

    if (!this.isDowned) {
      const localInBurrow = this.isPointInBurrow(this.playerPos.x, this.playerPos.z);
      const localHidden = localInBurrow || (this.getCurrentHideZone() !== null && this.isCrouching);
      targets.push({
        id: this.getLocalPlayerId(),
        pos: this.playerPos,
        eyeHeight: this.currentEyeHeight,
        isCrouching: this.isCrouching,
        isHidden: localHidden,
        isOutside: this.playerPos.z > 42.5,
        inBurrow: localInBurrow,
      });
    }

    if (this.mpActive) {
      for (const [id, p] of this.mpPlayers) {
        if (id === this.mpMyId || p.isDowned) continue;
        const avatar = this.remoteAvatars.get(id);
        const pos = avatar ? avatar.curPos : new THREE.Vector3(p.x, p.y, p.z);
        const inB = this.isPointInBurrow(pos.x, pos.z);
        const hid = inB || (this.isPointInHideZone(pos.x, pos.y, pos.z) !== null && p.isCrouching);
        targets.push({
          id,
          pos,
          eyeHeight: p.isCrouching ? CROUCH_EYE : STAND_EYE,
          isCrouching: p.isCrouching,
          isHidden: hid,
          isOutside: pos.z > 42.5,
          inBurrow: inB,
        });
      }
    }

    return targets;
  }

  private fireHumanWeapon(aimTarget: THREE.Vector3): void {
    if (this.humanWeapon === 'broom') return;

    this.human.group.updateMatrixWorld(true);
    const muzzleOrigin = new THREE.Vector3();
    this.human.muzzleFlash.getWorldPosition(muzzleOrigin);

    _v1.set(aimTarget.x, aimTarget.y + 0.85, aimTarget.z);
    _v2.copy(_v1).sub(muzzleOrigin);
    if (_v2.lengthSq() < 0.01) return;
    _v2.normalize();

    this.sound.playGunshot(this.humanWeapon);
    this.humanMuzzleTimer = 0.085;
    this.humanRecoilTimer = 0.24;
    this.human.muzzleFlash.visible = true;
    if (this.humanPos.distanceTo(this.playerPos) < 28) {
      this.cameraShake = Math.max(this.cameraShake, this.humanWeapon === 'shotgun' ? 0.22 : 0.14);
    }

    const netBullets: Array<{ vx: number; vy: number; vz: number; damage: number }> = [];
    const spawnBullet = (dir: THREE.Vector3, speed: number, damage: number) => {
      const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
      m.position.copy(muzzleOrigin);
      this.scene.add(m);
      const vel = dir.clone().multiplyScalar(speed);
      this.bullets.push({
        mesh: m,
        vel,
        life: 1.8,
        damage,
      });
      netBullets.push({ vx: vel.x, vy: vel.y, vz: vel.z, damage });
    };

    if (this.humanWeapon === 'revolver') {
      spawnBullet(_v2, 52, 20);
      this.humanShootCooldown = 1.4;
      this.humanAimTimer = 0.55;
    } else if (this.humanWeapon === 'rifle') {
      spawnBullet(_v2, 74, 30);
      this.humanShootCooldown = 2.0;
      this.humanAimTimer = 0.72;
    } else {
      for (let i = 0; i < 5; i++) {
        const spreadDir = _v2.clone();
        spreadDir.x += (Math.random() - 0.5) * 0.16;
        spreadDir.y += (Math.random() - 0.5) * 0.09;
        spreadDir.z += (Math.random() - 0.5) * 0.16;
        spreadDir.normalize();
        spawnBullet(spreadDir, 42, 9);
      }
      this.humanShootCooldown = 1.85;
      this.humanAimTimer = 0.6;
    }

    if (this.mpActive && this.mpIsHost) {
      this.mpClient.send({
        type: 'human:shoot',
        weapon: this.humanWeapon,
        origin: { x: muzzleOrigin.x, y: muzzleOrigin.y, z: muzzleOrigin.z },
        bullets: netBullets,
      });
    }
  }

  private hasLineOfSightFromHuman(targetPos: THREE.Vector3): boolean {
    const eyeOrig = _v2.set(this.humanPos.x, 15.5, this.humanPos.z);
    const playerMid = _v3.set(targetPos.x, targetPos.y + 0.9, targetPos.z);
    const minX = Math.min(eyeOrig.x, playerMid.x);
    const maxX = Math.max(eyeOrig.x, playerMid.x);
    const minZ = Math.min(eyeOrig.z, playerMid.z);
    const maxZ = Math.max(eyeOrig.z, playerMid.z);
    for (const c of this.world.colliders) {
      if (c.maxY < 10) continue;
      if (
        c.id.startsWith('div-') ||
        c.id.startsWith('fridge') ||
        c.id.startsWith('bs-') ||
        c.id.startsWith('wardrobe') ||
        c.id.startsWith('wall-')
      ) {
        if (c.maxX > minX && c.minX < maxX && c.maxZ > minZ && c.minZ < maxZ) {
          const steps = 8;
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const sx = THREE.MathUtils.lerp(eyeOrig.x, playerMid.x, t);
            const sy = THREE.MathUtils.lerp(eyeOrig.y, playerMid.y, t);
            const sz = THREE.MathUtils.lerp(eyeOrig.z, playerMid.z, t);
            if (sx > c.minX && sx < c.maxX && sz > c.minZ && sz < c.maxZ && sy > c.minY && sy < c.maxY) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  private hasHumanWallClearance(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const steps = 10;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const sx = THREE.MathUtils.lerp(a.x, b.x, t);
      const sz = THREE.MathUtils.lerp(a.z, b.z, t);
      for (const c of this.world.colliders) {
        if (c.isFloorLike || c.maxY <= 2.2 || c.minY >= 17.5) continue;
        if (sx + 1.4 > c.minX && sx - 1.4 < c.maxX && sz + 1.4 > c.minZ && sz - 1.4 < c.maxZ) {
          return false;
        }
      }
    }
    return true;
  }

  private findClosestNavNode(pos: THREE.Vector3): string {
    const nodes = this.world.navNodes;
    let bestClearId = '';
    let bestClearDist = Infinity;
    let bestAnyId = nodes[0].id;
    let bestAnyDist = Infinity;

    for (const node of nodes) {
      const d = Math.hypot(node.pos.x - pos.x, node.pos.z - pos.z);
      if (d < bestAnyDist) {
        bestAnyDist = d;
        bestAnyId = node.id;
      }
      if (d < bestClearDist && this.hasHumanWallClearance(pos, node.pos)) {
        bestClearDist = d;
        bestClearId = node.id;
      }
    }
    return bestClearId || bestAnyId;
  }

  private findHousePath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (this.hasHumanWallClearance(from, to)) {
      return [to.clone()];
    }
    const nodes = this.world.navNodes;
    const edges = this.world.navEdges;
    const startId = this.findClosestNavNode(from);
    const goalId = this.findClosestNavNode(to);
    const queue: string[][] = [[startId]];
    const visited = new Set<string>([startId]);

    while (queue.length > 0) {
      const path = queue.shift()!;
      const cur = path[path.length - 1];
      if (cur === goalId) {
        const result = path.map((id) => nodes.find((n) => n.id === id)!.pos.clone());
        result.push(to.clone());
        return result;
      }
      for (const nxt of edges[cur] ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push([...path, nxt]);
        }
      }
    }
    return [to.clone()];
  }

  private triggerGrabStruggle(): void {
    if (this.humanGrabState !== 'carrying' || this.humanGrabTargetId !== this.getLocalPlayerId()) return;
    this.grabStruggle = Math.min(1, this.grabStruggle + 0.16);
    this.cameraShake = Math.max(this.cameraShake, 0.12);
    this.sound.playGrab();

    if (this.grabStruggle >= 1) {
      this.grabStruggle = 0;
      if (this.mpActive && !this.mpIsHost) {
        this.mpClient.send({ type: 'human:escape' });
        this.humanGrabState = 'none';
        this.humanGrabTargetId = null;
        this.playerVel.set(-Math.sin(this.yaw) * 9, 8.5, -Math.cos(this.yaw) * 9);
        this.isGrounded = false;
        this.sound.playJump(true);
        this.showNotification('Ты вырвался из рук соседа! Беги!');
      } else {
        this.releaseGrabbedPlayerByEscape(this.getLocalPlayerId());
      }
    }
    this.emitHud();
  }

  private releaseGrabbedPlayerByEscape(victimId: string): void {
    this.humanGrabState = 'none';
    this.humanGrabTargetId = null;
    this.humanCarryPath = [];
    this.humanCarryIdx = 0;
    this.humanAttackCooldown = 3.0;
    this.humanStartleTimer = 0.65;
    this.grabStruggle = 0;
    this.sound.playJump(true);

    if (victimId === this.getLocalPlayerId()) {
      const pushX = Math.sin(this.humanYaw) * 3.0;
      const pushZ = Math.cos(this.humanYaw) * 3.0;
      const minX = this.world.house.mirrorX ? -32 : -34;
      const maxX = this.world.house.mirrorX ? 90 : 88;
      this.playerPos.set(
        THREE.MathUtils.clamp(this.humanPos.x + pushX, minX, maxX),
        1.2,
        THREE.MathUtils.clamp(this.humanPos.z + pushZ, -54, 71)
      );
      this.playerVel.set(pushX * 3.2, 8.5, pushZ * 3.2);
      this.isGrounded = false;
      this.wasGrounded = false;
      this.showNotification('Ты вырвался из рук соседа! Беги в укрытие!');
    }
  }

  private updateHumanAI(dt: number): void {
    if (this.inTreeHub) {
      this.applyHumanRigPose(dt, 0, 0, 0, false);
      return;
    }

    if (this.humanDead) {
      this.humanDeathFall = Math.min(1, this.humanDeathFall + dt * 2.8);
      this.human.muzzleFlash.visible = false;
      this.human.alertBadge.visible = false;
      this.human.group.position.set(this.humanPos.x, 1.45 * this.humanDeathFall, this.humanPos.z);
      this.human.group.rotation.set(0, this.humanYaw, (Math.PI / 2) * this.humanDeathFall);
      return;
    }

    const allTargets = this.getAlivePlayerTargets();

    if (this.humanMuzzleTimer > 0) {
      this.humanMuzzleTimer -= dt;
      if (this.humanMuzzleTimer <= 0) this.human.muzzleFlash.visible = false;
    }
    if (this.humanRecoilTimer > 0) this.humanRecoilTimer = Math.max(0, this.humanRecoilTimer - dt);
    if (this.humanShootCooldown > 0) this.humanShootCooldown = Math.max(0, this.humanShootCooldown - dt);
    if (this.humanWeaponTimer > 0) this.humanWeaponTimer = Math.max(0, this.humanWeaponTimer - dt);
    if (this.humanAttackCooldown > 0) this.humanAttackCooldown -= dt;
    if (this.humanStartleTimer > 0) this.humanStartleTimer = Math.max(0, this.humanStartleTimer - dt);
    if (this.humanSwipeTimer > 0) this.humanSwipeTimer = Math.max(0, this.humanSwipeTimer - dt);

    // Handle active Grab & Room-to-Porch Throw sequence (NO teleporting!)
    if (this.humanGrabState !== 'none') {
      this.humanGrabTimer -= dt;
      const porchTarget = this.world.porchTargetPos;

      let legSwing = 0;
      let torsoBounce = 0;
      let torsoRoll = 0;
      if (this.humanGrabState === 'carrying') {
        if (this.humanCarryPath.length === 0) {
          this.humanCarryPath = this.findHousePath(this.humanPos, porchTarget);
          this.humanCarryIdx = 0;
        }
        while (this.humanCarryIdx < this.humanCarryPath.length - 1) {
          const wp = this.humanCarryPath[this.humanCarryIdx];
          if (Math.hypot(wp.x - this.humanPos.x, wp.z - this.humanPos.z) < 2.2) {
            this.humanCarryIdx++;
          } else {
            break;
          }
        }
        const activeWp = this.humanCarryPath[this.humanCarryIdx] ?? porchTarget;
        _v1.set(activeWp.x - this.humanPos.x, 0, activeWp.z - this.humanPos.z);
        const distWp = _v1.length();

        if (distWp > 0.6) {
          _v1.normalize();
          const desiredYaw = Math.atan2(_v1.x, _v1.z);
          const diff = normalizeAngle(desiredYaw - this.humanYaw);
          this.humanYaw += diff * Math.min(1, dt * 8.5);

          const carrySpeed = 18.2;
          const stepDist = carrySpeed * dt;
          this.moveHumanWithCollisions(_v1.x * stepDist, _v1.z * stepDist, stepDist);
          this.humanWalkPhase += dt * carrySpeed * 0.72;
          legSwing = Math.sin(this.humanWalkPhase) * 0.58;
          torsoRoll = Math.cos(this.humanWalkPhase) * 0.065;
          torsoBounce = Math.abs(Math.sin(this.humanWalkPhase)) * 0.28;

          const stepHalf = Math.floor(this.humanWalkPhase / Math.PI);
          if (stepHalf !== this.humanLastStepHalf) {
            this.humanLastStepHalf = stepHalf;
            this.sound.playHumanThud(0.85);
            if (this.humanGrabTargetId === this.getLocalPlayerId()) {
              this.cameraShake = Math.max(this.cameraShake, 0.14);
            }
          }
        }

        this.human.leftArm.rotation.x = THREE.MathUtils.damp(this.human.leftArm.rotation.x, -1.42, 16, dt);
        this.human.rightArm.rotation.x = THREE.MathUtils.damp(this.human.rightArm.rotation.x, legSwing * 0.5, 12, dt);
        this.human.torsoGroup.position.y = 8.4 + torsoBounce;
        this.human.torsoGroup.rotation.z = THREE.MathUtils.damp(this.human.torsoGroup.rotation.z, torsoRoll, 10, dt);

        const atFrontPorch =
          this.humanPos.z >= 43.8 && Math.abs(this.humanPos.x - this.world.porchTargetPos.x) < 5.5;
        if (atFrontPorch || this.humanGrabTimer <= 0) {
          this.humanGrabState = 'winding_up';
          this.humanGrabTimer = 0.36;
        }
      } else {
        // Winding up on the porch facing South (+Z, yaw = 0) toward the front yard
        const throwYaw = 0;
        const diff = normalizeAngle(throwYaw - this.humanYaw);
        this.humanYaw += diff * Math.min(1, dt * 12);
        this.human.leftArm.rotation.x = THREE.MathUtils.damp(this.human.leftArm.rotation.x, -2.55, 18, dt);
        this.human.torsoGroup.rotation.x = THREE.MathUtils.damp(this.human.torsoGroup.rotation.x, -0.34, 14, dt);

        if (this.humanGrabTimer <= 0) {
          const victimId = this.humanGrabTargetId;
          this.humanGrabState = 'none';
          this.humanGrabTargetId = null;
          this.humanCarryPath = [];
          this.humanCarryIdx = 0;
          this.humanAttackCooldown = 3.2;
          this.humanSwipeTimer = 0.45;
          this.humanPorchPauseTimer = 0.9;
          this.grabStruggle = 0;

          // Launch physically straight from the Neighbor's actual fist position (ZERO teleport!)
          this.human.group.position.copy(this.humanPos);
          this.human.group.rotation.y = this.humanYaw;
          this.human.group.updateMatrixWorld(true);
          const handPos = new THREE.Vector3();
          this.human.grabHandAnchor.getWorldPosition(handPos);

          const dropX = handPos.x;
          const dropY = Math.max(4.4, Math.min(10.5, handPos.y - 0.3));
          const dropZ = Math.max(43.8, handPos.z);
          const toStreetX = THREE.MathUtils.clamp((this.world.streetDropPos.x - dropX) * 0.9, -7, 7);

          if (victimId === this.getLocalPlayerId()) {
            this.inMiniCopter = false;
            this.inDroneMode = false;
            this.mavicDrone.group.visible = false;
            this.playerPos.set(dropX, dropY, dropZ);
            this.playerVel.set(toStreetX, 8.8, 22.5);
            this.isGrounded = false;
            this.wasGrounded = false;
            this.sound.playThrow();
            this.damagePlayer(20, 'Сосед вынес тебя на крыльцо и швырнул во двор!');
          } else if (this.mpActive && victimId) {
            this.mpClient.send({
              type: 'human:throw_player',
              targetId: victimId,
              x: dropX,
              y: dropY,
              z: dropZ,
              vx: toStreetX,
              vy: 8.8,
              vz: 22.5,
              damage: 20,
            });
            this.sound.playThrow();
          }
          return;
        }
      }

      this.human.leftLeg.rotation.x = THREE.MathUtils.damp(this.human.leftLeg.rotation.x, legSwing, 12, dt);
      this.human.rightLeg.rotation.x = THREE.MathUtils.damp(this.human.rightLeg.rotation.x, -legSwing, 12, dt);
      this.human.group.position.copy(this.humanPos);
      this.human.group.rotation.y = this.humanYaw;
      this.human.group.updateMatrixWorld(true);

      if (this.humanGrabTargetId === this.getLocalPlayerId()) {
        this.human.grabHandAnchor.getWorldPosition(_v2);
        this.playerPos.set(_v2.x, Math.max(1.4, _v2.y - 0.6), _v2.z);
        this.playerVel.set(0, 0, 0);
      }
      return;
    }

    // Brief dramatic pause on the porch watching the thrown gnome land before walking back inside
    if (this.humanPorchPauseTimer > 0) {
      this.humanPorchPauseTimer -= dt;
      this.humanYaw = THREE.MathUtils.damp(this.humanYaw, 0, 8, dt);
      this.applyHumanRigPose(dt, 0, 0, 0, false);
      return;
    }

    // Find closest visible exposed gnome among all players
    let bestTarget: (typeof allTargets)[number] | null = null;
    let bestDist = Infinity;
    let bestCrouching = false;

    for (const tgt of allTargets) {
      if (tgt.isHidden || tgt.isOutside) continue;
      const dx = tgt.pos.x - this.humanPos.x;
      const dz = tgt.pos.z - this.humanPos.z;
      const d = Math.hypot(dx, dz);
      if (d >= 36) continue;
      _v2.set(Math.sin(this.humanYaw), 0, Math.cos(this.humanYaw));
      _v3.set(dx, 0, dz).normalize();
      const fovDot = _v2.dot(_v3);
      if ((fovDot > 0.22 || d < 6.5) && this.hasLineOfSightFromHuman(tgt.pos)) {
        if (d < bestDist) {
          bestDist = d;
          bestTarget = tgt;
          bestCrouching = tgt.isCrouching;
        }
      }
    }

    const seesPlayer = bestTarget !== null;
    if (bestTarget) {
      this.humanSuspicion = Math.min(1, this.humanSuspicion + dt * (bestCrouching ? 0.95 : 1.75));
      this.humanLastKnownPos.copy(bestTarget.pos);
      this.humanLostSightTimer = 4.5;
      if (this.humanSuspicion >= 1 && this.humanAlert !== 'chase') {
        this.humanAlert = 'chase';
        this.humanStartleTimer = 0.65;
        this.sound.playHumanAlert();
        this.showNotification('Хозяин заметил гнома! Прячьтесь под мебель или бегите в нору!');
      } else if (this.humanSuspicion > 0.35 && this.humanAlert === 'patrol') {
        this.humanAlert = 'suspicious';
        this.humanStartleTimer = 0.48;
      }
    } else {
      if (this.humanAlert === 'chase') {
        this.humanLostSightTimer -= dt;
        if (this.humanLostSightTimer <= 0) {
          this.humanAlert = 'suspicious';
          this.humanSuspicion = 0.5;
        }
      } else {
        this.humanSuspicion = Math.max(0, this.humanSuspicion - dt * 0.35);
        if (this.humanSuspicion <= 0.05) this.humanAlert = 'patrol';
      }
    }

    const focusDist = bestTarget ? bestDist : this.humanPos.distanceTo(this.humanLastKnownPos);

    if (this.humanAlert === 'chase') {
      if (this.humanWeapon === 'broom' || this.humanWeaponTimer <= 0) {
        const desiredWeapon: HumanWeapon =
          focusDist > 22 ? 'rifle' : focusDist > 10.5 ? 'revolver' : 'shotgun';
        this.setHumanWeapon(desiredWeapon);
        this.humanWeaponTimer = 3.5;
      }
    } else {
      this.setHumanWeapon('broom', true);
      this.humanAimTimer = 0;
    }

    let targetPos: THREE.Vector3;
    let moveSpeed = 6.4;
    if (this.humanAlert === 'chase') {
      targetPos = bestTarget ? bestTarget.pos : this.humanLastKnownPos;
      moveSpeed = 11.0;
    } else if (this.humanAlert === 'suspicious') {
      targetPos = this.humanLastKnownPos;
      moveSpeed = 7.4;
    } else {
      targetPos = this.world.patrolWaypoints[this.humanWaypointIdx];
      if (Math.hypot(targetPos.x - this.humanPos.x, targetPos.z - this.humanPos.z) < 2.2) {
        this.humanWaypointIdx = (this.humanWaypointIdx + 1) % this.world.patrolWaypoints.length;
        targetPos = this.world.patrolWaypoints[this.humanWaypointIdx];
      }
    }

    // Use doorway-aware waypoint steering if a divider wall is between Neighbor and targetPos
    const clampedGoal = _v3.set(targetPos.x, 0, Math.min(37.5, targetPos.z));
    let steerTarget = clampedGoal;
    if (!this.hasHumanWallClearance(this.humanPos, clampedGoal)) {
      const path = this.findHousePath(this.humanPos, clampedGoal);
      for (const wp of path) {
        if (Math.hypot(wp.x - this.humanPos.x, wp.z - this.humanPos.z) > 1.8) {
          steerTarget = wp;
          break;
        }
      }
    }

    _v1.set(steerTarget.x - this.humanPos.x, 0, steerTarget.z - this.humanPos.z);
    const distTarget = _v1.length();
    let legSwing = 0;
    let torsoRoll = 0;
    let torsoBounce = 0;

    const isAimingGun =
      this.humanAlert === 'chase' &&
      this.humanWeapon !== 'broom' &&
      seesPlayer &&
      bestTarget !== null &&
      bestDist > 4.8;
    this.humanRemoteAiming = isAimingGun;

    if (isAimingGun && bestTarget && this.humanShootCooldown <= 0) {
      this.humanAimTimer -= dt;
      if (this.humanAimTimer <= 0) {
        this.fireHumanWeapon(bestTarget.pos);
      }
    }

    if (distTarget > 0.5) {
      _v1.normalize();
      const desiredYaw = Math.atan2(_v1.x, _v1.z);
      const diff = normalizeAngle(desiredYaw - this.humanYaw);
      this.humanYaw += diff * Math.min(1, dt * 5.8);

      const speedScale =
        this.humanStartleTimer > 0.3 ? 0.35 : isAimingGun && this.humanShootCooldown <= 0 ? 0.45 : 1.0;
      const stepDist = moveSpeed * speedScale * dt;
      this.moveHumanWithCollisions(_v1.x * stepDist, _v1.z * stepDist, stepDist);
      const minHX = this.world.house.mirrorX ? -32 : -34;
      const maxHX = this.world.house.mirrorX ? 90 : 88;
      this.humanPos.x = THREE.MathUtils.clamp(this.humanPos.x, minHX, maxHX);
      this.humanPos.z = THREE.MathUtils.clamp(this.humanPos.z, -53, 45.2);

      this.humanWalkPhase += dt * moveSpeed * speedScale * 0.78;
      const amp = this.humanAlert === 'chase' ? 0.58 : 0.44;
      legSwing = Math.sin(this.humanWalkPhase) * amp;
      torsoRoll = Math.cos(this.humanWalkPhase) * (this.humanAlert === 'chase' ? 0.08 : 0.05);
      torsoBounce = Math.abs(Math.sin(this.humanWalkPhase)) * (this.humanAlert === 'chase' ? 0.34 : 0.18);

      const distToLocal = Math.hypot(this.playerPos.x - this.humanPos.x, this.playerPos.z - this.humanPos.z);
      const stepHalf = Math.floor(this.humanWalkPhase / Math.PI);
      if (stepHalf !== this.humanLastStepHalf) {
        this.humanLastStepHalf = stepHalf;
        const distFactor = Math.max(0, 1 - distToLocal / 48);
        if (distFactor > 0.06) {
          this.sound.playHumanThud(distFactor);
        }
        if (distToLocal < 26) {
          const proximity = 1 - distToLocal / 26;
          const chaseMult = this.humanAlert === 'chase' ? 1.45 : 0.9;
          this.cameraShake = Math.max(this.cameraShake, 0.14 * proximity * chaseMult);
        }
      }
    }

    this.applyHumanRigPose(dt, legSwing, torsoRoll, torsoBounce, isAimingGun);

    // Close-range Grab & Physical Room-to-Porch Throw!
    if (
      this.humanAlert === 'chase' &&
      bestTarget &&
      bestDist < 4.5 &&
      bestTarget.pos.y < 5.5 &&
      this.humanAttackCooldown <= 0
    ) {
      this.humanGrabState = 'carrying';
      this.humanGrabTimer = 11.0; // Generous cap while physically walking through doorways to the porch
      this.humanGrabTargetId = bestTarget.id;
      this.humanCarryPath = this.findHousePath(this.humanPos, this.world.porchTargetPos);
      this.humanCarryIdx = 0;
      this.grabStruggle = 0;
      if (bestTarget.id === this.getLocalPlayerId()) {
        this.heldProp = null;
        this.isClimbing = false;
        this.sound.playHumanGrab();
        this.showNotification('Сосед схватил тебя и тащит к выходу! Жми [Space] / [ЛКМ], чтобы вырваться!');
      } else {
        this.sound.playHumanGrab();
      }
    }
  }

  private updateHumanClientInterpolated(dt: number): void {
    if (this.humanDead) {
      this.humanDeathFall = Math.min(1, this.humanDeathFall + dt * 2.8);
      this.human.muzzleFlash.visible = false;
      this.human.alertBadge.visible = false;
      this.human.group.position.set(this.humanPos.x, 1.45 * this.humanDeathFall, this.humanPos.z);
      this.human.group.rotation.set(0, this.humanYaw, (Math.PI / 2) * this.humanDeathFall);
      return;
    }

    if (this.humanMuzzleTimer > 0) {
      this.humanMuzzleTimer -= dt;
      if (this.humanMuzzleTimer <= 0) this.human.muzzleFlash.visible = false;
    }
    if (this.humanRecoilTimer > 0) this.humanRecoilTimer = Math.max(0, this.humanRecoilTimer - dt);
    if (this.humanStartleTimer > 0) this.humanStartleTimer = Math.max(0, this.humanStartleTimer - dt);
    if (this.humanSwipeTimer > 0) this.humanSwipeTimer = Math.max(0, this.humanSwipeTimer - dt);

    const prevX = this.humanPos.x;
    const prevZ = this.humanPos.z;
    this.humanPos.lerp(this.humanTargetPos, 1 - Math.exp(-14 * dt));

    let diff = this.humanTargetYaw - this.humanYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.humanYaw += diff * Math.min(1, dt * 14);

    const moved = Math.hypot(this.humanPos.x - prevX, this.humanPos.z - prevZ);
    const speed = moved / Math.max(dt, 0.001);
    let legSwing = 0;
    let torsoRoll = 0;
    let torsoBounce = 0;

    if (speed > 0.6) {
      this.humanWalkPhase += dt * Math.min(speed, 14) * 0.78;
      const amp = this.humanAlert === 'chase' ? 0.58 : 0.44;
      legSwing = Math.sin(this.humanWalkPhase) * amp;
      torsoRoll = Math.cos(this.humanWalkPhase) * (this.humanAlert === 'chase' ? 0.08 : 0.05);
      torsoBounce = Math.abs(Math.sin(this.humanWalkPhase)) * (this.humanAlert === 'chase' ? 0.34 : 0.18);

      const distToLocal = Math.hypot(this.playerPos.x - this.humanPos.x, this.playerPos.z - this.humanPos.z);
      const stepHalf = Math.floor(this.humanWalkPhase / Math.PI);
      if (stepHalf !== this.humanLastStepHalf) {
        this.humanLastStepHalf = stepHalf;
        const distFactor = Math.max(0, 1 - distToLocal / 48);
        if (distFactor > 0.06) this.sound.playHumanThud(distFactor);
        if (distToLocal < 26) {
          this.cameraShake = Math.max(this.cameraShake, 0.14 * (1 - distToLocal / 26));
        }
      }
    }

    if (this.humanGrabState !== 'none') {
      this.human.leftLeg.rotation.x = THREE.MathUtils.damp(this.human.leftLeg.rotation.x, legSwing, 12, dt);
      this.human.rightLeg.rotation.x = THREE.MathUtils.damp(this.human.rightLeg.rotation.x, -legSwing, 12, dt);
      this.human.leftArm.rotation.x = THREE.MathUtils.damp(
        this.human.leftArm.rotation.x,
        this.humanGrabState === 'winding_up' ? -2.5 : -1.35,
        16,
        dt
      );
      this.human.group.position.copy(this.humanPos);
      this.human.group.rotation.y = this.humanYaw;
      this.human.group.updateMatrixWorld(true);

      if (this.humanGrabTargetId === this.getLocalPlayerId()) {
        this.human.grabHandAnchor.getWorldPosition(_v2);
        this.playerPos.set(_v2.x, Math.max(1.4, _v2.y - 0.6), _v2.z);
        this.playerVel.set(0, 0, 0);
        this.heldProp = null;
        this.isClimbing = false;
        this.cameraShake = Math.max(this.cameraShake, 0.08);
      }
      return;
    }

    this.applyHumanRigPose(dt, legSwing, torsoRoll, torsoBounce, this.humanRemoteAiming);
  }

  private applyHumanRigPose(
    dt: number,
    legSwing: number,
    torsoRoll: number,
    torsoBounce: number,
    isAimingGun: boolean
  ): void {
    this.human.leftLeg.rotation.x = THREE.MathUtils.damp(this.human.leftLeg.rotation.x, legSwing, 12, dt);
    this.human.rightLeg.rotation.x = THREE.MathUtils.damp(this.human.rightLeg.rotation.x, -legSwing, 12, dt);

    let targetTorsoX = this.humanAlert === 'chase' ? 0.14 : 0.03;
    let targetLeftArmX = -legSwing * 0.72;
    let targetRightArmX = legSwing * 0.58;
    let targetLeftArmZ = 0.08;
    let targetRightArmZ = -0.08;
    let targetHeadY =
      this.humanAlert === 'patrol' ? Math.sin(this.elapsedTime * 1.15) * 0.55 : Math.sin(this.elapsedTime * 2.4) * 0.22;
    let targetHeadX = this.humanAlert === 'chase' ? 0.18 : 0.06;

    if (this.humanStartleTimer > 0) {
      const s = Math.sin((this.humanStartleTimer / 0.65) * Math.PI);
      targetLeftArmX = -2.35 * s;
      targetRightArmX = -2.05 * s;
      targetLeftArmZ = -0.35 * s;
      targetRightArmZ = 0.35 * s;
      targetTorsoX = -0.18 * s;
      targetHeadX = -0.22 * s;
    } else if (this.humanSwipeTimer > 0) {
      const p = 1 - this.humanSwipeTimer / 0.48;
      const lunge = Math.sin(p * Math.PI);
      targetTorsoX = 0.52 * lunge;
      targetRightArmX = -1.35 * lunge - 0.3;
      targetRightArmZ = -0.4 * lunge;
      targetLeftArmX = 0.45 * lunge;
    } else if (this.humanWeapon !== 'broom') {
      const recoilKick = this.humanRecoilTimer > 0 ? Math.sin((this.humanRecoilTimer / 0.24) * Math.PI) * 0.42 : 0;
      targetRightArmX = (isAimingGun ? -1.42 : -0.95) - recoilKick;
      targetRightArmZ = -0.06;
      if (this.humanWeapon === 'rifle' || this.humanWeapon === 'shotgun') {
        targetLeftArmX = isAimingGun ? -1.15 : -0.6;
        targetLeftArmZ = 0.35;
      }
      if (isAimingGun) {
        targetHeadY = 0;
        targetHeadX = 0.22;
      }
    }

    this.human.torsoGroup.position.y = 8.4 + torsoBounce;
    this.human.torsoGroup.rotation.z = THREE.MathUtils.damp(this.human.torsoGroup.rotation.z, torsoRoll, 10, dt);
    this.human.torsoGroup.rotation.x = THREE.MathUtils.damp(this.human.torsoGroup.rotation.x, targetTorsoX, 12, dt);
    this.human.leftArm.rotation.x = THREE.MathUtils.damp(this.human.leftArm.rotation.x, targetLeftArmX, 14, dt);
    this.human.leftArm.rotation.z = THREE.MathUtils.damp(this.human.leftArm.rotation.z, targetLeftArmZ, 12, dt);
    this.human.rightArm.rotation.x = THREE.MathUtils.damp(this.human.rightArm.rotation.x, targetRightArmX, 16, dt);
    this.human.rightArm.rotation.z = THREE.MathUtils.damp(this.human.rightArm.rotation.z, targetRightArmZ, 12, dt);
    this.human.head.rotation.y = THREE.MathUtils.damp(this.human.head.rotation.y, targetHeadY, 6, dt);
    this.human.head.rotation.x = THREE.MathUtils.damp(this.human.head.rotation.x, targetHeadX, 8, dt);

    this.human.alertBadge.visible = this.humanAlert !== 'patrol';
    if (this.human.alertBadge.visible) {
      const mat = this.human.alertBadge.material as THREE.MeshStandardMaterial;
      const color = this.humanAlert === 'chase' ? 0xd93829 : 0xe6a12c;
      mat.color.setHex(color);
      mat.emissive.setHex(color);
      this.human.alertBadge.rotation.y += dt * 3.5;
    }

    this.human.group.position.copy(this.humanPos);
    this.human.group.rotation.y = this.humanYaw;
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);

      let remove = b.life <= 0 || b.mesh.position.y < 0.05;

      // Check bullet vs world furniture/walls/tables/glass
      if (!remove) {
        const bx = b.mesh.position.x;
        const by = b.mesh.position.y;
        const bz = b.mesh.position.z;
        for (const c of this.world.colliders) {
          if (c.isFloorLike) continue;
          if (bx > c.minX && bx < c.maxX && by > c.minY && by < c.maxY && bz > c.minZ && bz < c.maxZ) {
            this.spawnBurst(b.mesh.position, 4, this.sparkMat);
            remove = true;
            break;
          }
        }
      }

      // Check bullet vs local gnome
      if (!remove && this.humanGrabTargetId !== this.getLocalPlayerId() && !this.isDowned) {
        const dx = b.mesh.position.x - this.playerPos.x;
        const dy = b.mesh.position.y - (this.playerPos.y + this.currentEyeHeight * 0.65);
        const dz = b.mesh.position.z - this.playerPos.z;
        if (dx * dx + dy * dy + dz * dz < 0.72 * 0.72) {
          this.spawnBurst(b.mesh.position, 5, this.sparkMat);
          this.damagePlayer(b.damage, 'Попадание соседа!');
          remove = true;
        }
      }

      if (remove) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }

  private moveHumanWithCollisions(dx: number, dz: number, stepDist: number): void {
    const r = 1.85;
    const isSolidForHuman = (c: AABBCollider) =>
      !c.isFloorLike && c.maxY > 2.2 && c.minY < 17.5;

    let blockedX = false;
    let blockedZ = false;
    let blockerCenterX = 0;
    let blockerCenterZ = 0;

    // Step 1: X axis
    this.humanPos.x += dx;
    for (const c of this.world.colliders) {
      if (!isSolidForHuman(c)) continue;
      if (
        this.humanPos.x + r > c.minX &&
        this.humanPos.x - r < c.maxX &&
        this.humanPos.z + r > c.minZ &&
        this.humanPos.z - r < c.maxZ
      ) {
        blockedX = true;
        blockerCenterZ = (c.minZ + c.maxZ) * 0.5;
        if (dx > 0) this.humanPos.x = c.minX - r;
        else if (dx < 0) this.humanPos.x = c.maxX + r;
        else {
          // Depenetrate along shallowest X overlap
          const penLeft = Math.abs(this.humanPos.x + r - c.minX);
          const penRight = Math.abs(c.maxX - (this.humanPos.x - r));
          this.humanPos.x = penLeft < penRight ? c.minX - r : c.maxX + r;
        }
      }
    }

    // Step 2: Z axis
    this.humanPos.z += dz;
    for (const c of this.world.colliders) {
      if (!isSolidForHuman(c)) continue;
      if (
        this.humanPos.x + r > c.minX &&
        this.humanPos.x - r < c.maxX &&
        this.humanPos.z + r > c.minZ &&
        this.humanPos.z - r < c.maxZ
      ) {
        blockedZ = true;
        blockerCenterX = (c.minX + c.maxX) * 0.5;
        if (dz > 0) this.humanPos.z = c.minZ - r;
        else if (dz < 0) this.humanPos.z = c.maxZ + r;
        else {
          const penFront = Math.abs(this.humanPos.z + r - c.minZ);
          const penBack = Math.abs(c.maxZ - (this.humanPos.z - r));
          this.humanPos.z = penFront < penBack ? c.minZ - r : c.maxZ + r;
        }
      }
    }

    // Step 3: Obstacle-avoidance tangent slide when pushing head-on into a table or wall
    if (blockedZ && Math.abs(dx) < stepDist * 0.45) {
      const sideDir = this.humanPos.x >= blockerCenterX ? 1 : -1;
      const slideX = sideDir * stepDist * 0.78;
      this.humanPos.x += slideX;
      for (const c of this.world.colliders) {
        if (!isSolidForHuman(c)) continue;
        if (
          this.humanPos.x + r > c.minX &&
          this.humanPos.x - r < c.maxX &&
          this.humanPos.z + r > c.minZ &&
          this.humanPos.z - r < c.maxZ
        ) {
          this.humanPos.x = slideX > 0 ? c.minX - r : c.maxX + r;
        }
      }
    } else if (blockedX && Math.abs(dz) < stepDist * 0.45) {
      const sideDir = this.humanPos.z >= blockerCenterZ ? 1 : -1;
      const slideZ = sideDir * stepDist * 0.78;
      this.humanPos.z += slideZ;
      for (const c of this.world.colliders) {
        if (!isSolidForHuman(c)) continue;
        if (
          this.humanPos.x + r > c.minX &&
          this.humanPos.x - r < c.maxX &&
          this.humanPos.z + r > c.minZ &&
          this.humanPos.z - r < c.maxZ
        ) {
          this.humanPos.z = slideZ > 0 ? c.minZ - r : c.maxZ + r;
        }
      }
    }
  }

  private updateInsectsAI(dt: number): void {
    const allTargets = this.getAlivePlayerTargets();

    for (let idx = 0; idx < this.world.insects.length; idx++) {
      const ins = this.world.insects[idx];
      if (ins.dead) {
        ins.deathTimer -= dt;
        ins.bodyGroup.rotation.z = THREE.MathUtils.damp(ins.bodyGroup.rotation.z, Math.PI, 14, dt);
        ins.bodyGroup.position.y = THREE.MathUtils.damp(ins.bodyGroup.position.y, 0.56, 14, dt);
        ins.legs.forEach((leg, i) => {
          leg.rotation.y = Math.sin(this.elapsedTime * 28 + i * 1.9) * 0.42;
          leg.rotation.z = Math.cos(this.elapsedTime * 24 + i) * 0.25;
        });
        if (ins.deathTimer <= 0) ins.mesh.visible = false;
        continue;
      }

      if (ins.attackCooldown > 0) ins.attackCooldown -= dt;
      if (ins.hitFlash > 0) ins.hitFlash -= dt;

      let chaseTarget: THREE.Vector3 | null = null;
      let minDist = 10.5;
      for (const tgt of allTargets) {
        if (tgt.inBurrow) continue;
        if (Math.abs(ins.position.y - tgt.pos.y) >= 1.8) continue;
        const d = ins.position.distanceTo(tgt.pos);
        if (d < minDist) {
          minDist = d;
          chaseTarget = tgt.pos;
        }
      }

      let target = ins.patrolTarget;
      let speed = ins.kind === 'cockroach' ? 4.8 : 4.0;
      if (chaseTarget) {
        target = chaseTarget;
        speed = ins.kind === 'cockroach' ? 7.2 : 6.4;
      } else if (ins.position.distanceTo(ins.patrolTarget) < 1.2) {
        ins.patrolTarget.set(
          ins.homePos.x + (Math.random() - 0.5) * 11,
          ins.homePos.y,
          ins.homePos.z + (Math.random() - 0.5) * 11
        );
      }

      _v1.set(target.x - ins.position.x, 0, target.z - ins.position.z);
      let isMoving = false;
      if (_v1.lengthSq() > 0.05) {
        isMoving = true;
        _v1.normalize();
        ins.yaw = Math.atan2(_v1.x, _v1.z);
        ins.position.x += _v1.x * speed * dt;
        ins.position.z += _v1.z * speed * dt;
      }

      ins.position.addScaledVector(ins.velocity, dt);
      ins.velocity.multiplyScalar(Math.exp(-8 * dt));
      if (ins.position.y > ins.homePos.y) {
        ins.velocity.y -= 28 * dt;
        if (ins.position.y <= ins.homePos.y) {
          ins.position.y = ins.homePos.y;
          ins.velocity.y = 0;
        }
      }

      ins.mesh.position.copy(ins.position);
      ins.mesh.rotation.y = ins.yaw;
      this.animateInsectBody(ins, idx, dt, isMoving, speed);

      const playerInBurrow = this.isPointInBurrow(this.playerPos.x, this.playerPos.z);
      const distToLocal = ins.position.distanceTo(this.playerPos);
      const sameHeight = Math.abs(ins.position.y - this.playerPos.y) < 1.8;
      if (!playerInBurrow && !this.isDowned && distToLocal < 1.25 && sameHeight && ins.attackCooldown <= 0) {
        ins.attackCooldown = 1.25;
        this.damagePlayer(12, ins.kind === 'spider' ? 'Укус паука!' : 'Укус таракана!');
      }
    }
  }

  private updateInsectsClientInterpolated(dt: number): void {
    const playerInBurrow = this.isPointInBurrow(this.playerPos.x, this.playerPos.z);
    for (let idx = 0; idx < this.world.insects.length; idx++) {
      const ins = this.world.insects[idx];
      if (ins.dead) {
        ins.deathTimer -= dt;
        ins.bodyGroup.rotation.z = THREE.MathUtils.damp(ins.bodyGroup.rotation.z, Math.PI, 14, dt);
        ins.bodyGroup.position.y = THREE.MathUtils.damp(ins.bodyGroup.position.y, 0.56, 14, dt);
        ins.legs.forEach((leg, i) => {
          leg.rotation.y = Math.sin(this.elapsedTime * 28 + i * 1.9) * 0.42;
          leg.rotation.z = Math.cos(this.elapsedTime * 24 + i) * 0.25;
        });
        if (ins.deathTimer <= 0) ins.mesh.visible = false;
        continue;
      }

      if (ins.attackCooldown > 0) ins.attackCooldown -= dt;
      if (ins.hitFlash > 0) ins.hitFlash -= dt;

      const prevX = ins.mesh.position.x;
      const prevZ = ins.mesh.position.z;
      ins.mesh.position.lerp(ins.position, 1 - Math.exp(-14 * dt));
      ins.mesh.rotation.y = ins.yaw;
      const distMoved = Math.hypot(ins.mesh.position.x - prevX, ins.mesh.position.z - prevZ);
      const isMoving = distMoved > 0.004;
      this.animateInsectBody(ins, idx, dt, isMoving, 5.5);

      const distToLocal = ins.mesh.position.distanceTo(this.playerPos);
      const sameHeight = Math.abs(ins.mesh.position.y - this.playerPos.y) < 1.8;
      if (!playerInBurrow && !this.isDowned && distToLocal < 1.25 && sameHeight && ins.attackCooldown <= 0) {
        ins.attackCooldown = 1.25;
        this.damagePlayer(12, ins.kind === 'spider' ? 'Укус паука!' : 'Укус таракана!');
      }
    }
  }

  private animateInsectBody(
    ins: InsectEntity,
    idx: number,
    _dt: number,
    isMoving: boolean,
    speed: number
  ): void {
    if (ins.hitFlash > 0) {
      const s = 1 + Math.sin((ins.hitFlash / 0.22) * Math.PI) * 0.25;
      ins.bodyGroup.scale.set(s, 1 / s, s);
    } else {
      ins.bodyGroup.scale.set(1, 1, 1);
    }

    const scuttleSpeed = isMoving ? speed * 4.5 : 8.0;
    const t = this.elapsedTime * scuttleSpeed + idx * 1.7;
    ins.legs.forEach((leg, i) => {
      leg.rotation.y = Math.sin(t + i * 1.45) * (isMoving ? 0.46 : 0.12);
      leg.rotation.z = 0;
    });
    ins.bodyGroup.position.y = isMoving ? Math.abs(Math.sin(t * 0.5)) * 0.04 : 0;

    ins.antennae.forEach((ant, i) => {
      ant.rotation.x = Math.sin(this.elapsedTime * 16 + i * 2.3 + idx) * 0.22;
      ant.rotation.y = Math.cos(this.elapsedTime * 12 + i * 1.7 + idx) * 0.28;
    });
  }

  private updateHeadBobbing(dt: number, horizSpeed: number, isMoving: boolean, isSprinting: boolean): void {
    const targetBlend = isMoving ? THREE.MathUtils.clamp(horizSpeed / 10, 0.25, 1.15) : 0;
    this.bobBlend = THREE.MathUtils.damp(this.bobBlend, targetBlend, 10, dt);

    if (isMoving) {
      const freq = isSprinting ? 14.5 : this.isCrouching ? 8.2 : 10.6;
      this.bobPhase += dt * freq;
    }

    const targetRoll = isMoving
      ? Math.cos(this.bobPhase) * (isSprinting ? 0.022 : 0.015) * this.bobBlend
      : 0;
    this.bobRoll = THREE.MathUtils.damp(this.bobRoll, targetRoll, 12, dt);
    this.landingDip = THREE.MathUtils.damp(this.landingDip, 0, 14, dt);
  }

  private updateFirstPersonHands(dt: number, isMoving: boolean, isSprinting: boolean): void {
    const lArm = this.hands.leftArm;
    const rArm = this.hands.rightArm;
    const t = this.elapsedTime;

    // Base resting pose
    let lx = -0.34;
    let ly = -0.32;
    let lz = -0.42;
    let lrx = 0.08;
    let lry = 0.1;
    let lrz = 0;

    let rx = 0.34;
    let ry = -0.32;
    let rz = -0.42;
    let rrx = 0.08;
    let rry = -0.1;
    let rrz = 0;

    // Subtle idle breathing
    const idleBreath = Math.sin(t * 2.4) * 0.01;
    ly += idleBreath;
    ry += idleBreath;

    // Step-synced walk/sprint swing
    if (this.bobBlend > 0.02) {
      const swingAmt = (isSprinting ? 0.065 : 0.042) * this.bobBlend;
      const s = Math.sin(this.bobPhase);
      const c = Math.abs(Math.cos(this.bobPhase));
      ly += c * swingAmt * 0.7;
      ry += c * swingAmt * 0.7;
      lz += s * swingAmt * 1.4;
      rz -= s * swingAmt * 1.4;
      lrx += s * 0.22 * this.bobBlend;
      rrx -= s * 0.22 * this.bobBlend;
    }

    // Climbing alternation
    if (this.isClimbing) {
      const climbPhase = t * 9.5;
      ly += Math.sin(climbPhase) * 0.12 + 0.08;
      ry -= Math.sin(climbPhase) * 0.12 - 0.08;
      lz -= 0.16;
      rz -= 0.16;
      lrx = 0.65;
      rrx = 0.65;
    } else if (this.heldProp) {
      // Reach forward and clasp held item!
      const reach = this.grabReachTimer > 0 ? Math.sin((this.grabReachTimer / 0.25) * Math.PI) * 0.14 : 0;
      const spread = Math.min(0.26, this.heldProp.radius * 0.22);
      lx = -0.22 - spread * 0.3;
      rx = 0.22 + spread * 0.3;
      ly = -0.16;
      ry = -0.16;
      lz = -0.58 - reach;
      rz = -0.58 - reach;
      lrx = 0.42;
      rrx = 0.42;
      lry = -0.35;
      rry = 0.35;

      // Tense trembling when carrying heavy items!
      if (this.heldProp.weight >= 2) {
        const strain = Math.min(1.6, this.heldProp.weight * 0.38);
        const jitX = Math.sin(t * 44) * 0.012 * strain;
        const jitY = Math.cos(t * 39) * 0.012 * strain;
        lx += jitX;
        ly += jitY;
        rx -= jitX;
        ry -= jitY;
      }
    } else if (this.grabReachTimer > 0) {
      // Quick reach pulse when throwing/dropping
      const reach = Math.sin((this.grabReachTimer / 0.25) * Math.PI);
      lz -= reach * 0.22;
      rz -= reach * 0.22;
      lrx += reach * 0.45;
      rrx += reach * 0.45;
    }

    // Stick windup, strike & recoil
    if (this.upgrades.stick && this.stickSwingTimer > 0 && !this.heldProp) {
      const p = 1 - this.stickSwingTimer / 0.24;
      if (p < 0.28) {
        // Windup back & up
        const w = p / 0.28;
        ry += w * 0.12;
        rz += w * 0.1;
        rrx += w * 0.65;
        rrz -= w * 0.45;
      } else {
        // Strike forward & across with recoil
        const s = Math.sin(((p - 0.28) / 0.72) * Math.PI);
        rx -= s * 0.18;
        ry -= s * 0.1;
        rz -= s * 0.28;
        rrx -= s * 1.25;
        rry += s * 0.55;
        rrz += s * 0.35;
      }
    }

    const dampK = this.stickSwingTimer > 0 ? 28 : 16;
    lArm.position.x = THREE.MathUtils.damp(lArm.position.x, lx, dampK, dt);
    lArm.position.y = THREE.MathUtils.damp(lArm.position.y, ly, dampK, dt);
    lArm.position.z = THREE.MathUtils.damp(lArm.position.z, lz, dampK, dt);
    lArm.rotation.x = THREE.MathUtils.damp(lArm.rotation.x, lrx, dampK, dt);
    lArm.rotation.y = THREE.MathUtils.damp(lArm.rotation.y, lry, dampK, dt);
    lArm.rotation.z = THREE.MathUtils.damp(lArm.rotation.z, lrz, dampK, dt);

    rArm.position.x = THREE.MathUtils.damp(rArm.position.x, rx, dampK, dt);
    rArm.position.y = THREE.MathUtils.damp(rArm.position.y, ry, dampK, dt);
    rArm.position.z = THREE.MathUtils.damp(rArm.position.z, rz, dampK, dt);
    rArm.rotation.x = THREE.MathUtils.damp(rArm.rotation.x, rrx, dampK, dt);
    rArm.rotation.y = THREE.MathUtils.damp(rArm.rotation.y, rry, dampK, dt);
    rArm.rotation.z = THREE.MathUtils.damp(rArm.rotation.z, rrz, dampK, dt);
  }

  private updateGnomeNpcsAndBurrow(dt: number): void {
    const t = this.elapsedTime;

    // Flickering burrow hearth fire
    const flicker =
      Math.sin(t * 14.3) * 0.22 +
      Math.sin(t * 23.7) * 0.15 +
      Math.cos(t * 9.1) * 0.1;
    this.world.burrowLight.intensity = 2.15 + flicker;
    this.world.burrowFlame.scale.set(1 + flicker * 0.18, 1 + flicker * 0.32, 1 + flicker * 0.18);
    this.world.burrowFlame.rotation.z = Math.sin(t * 11) * 0.12;

    // Bubbling alchemy cauldron & TV screen broadcast shimmer
    this.world.cauldronBubbles.forEach((bub, bi) => {
      const cycle = (t * 0.85 + bi * 0.25) % 1;
      bub.position.y = 1.44 + cycle * 0.48;
      const s = Math.sin(cycle * Math.PI);
      bub.scale.setScalar(Math.max(0.1, s * 1.15));
    });
    this.world.tvScreenMat.emissiveIntensity = 1.18 + Math.sin(t * 7.2) * 0.12 + Math.cos(t * 17.5) * 0.06;

    // High-Gnome breathing, hat wobble, head-turn & quest gesturing
    const hg = this.world.highGnomeRig;
    const distToHg = this.playerPos.distanceTo(this.world.highGnomePos);
    const breathHg = Math.sin(t * 2.2);
    hg.torsoGroup.scale.y = 1 + breathHg * 0.025;
    hg.torsoGroup.position.y = breathHg * 0.02;
    hg.beard.rotation.x = Math.sin(t * 2.2 - 0.6) * 0.05;
    hg.hatGroup.rotation.z = Math.sin(t * 1.9) * 0.045;
    hg.hatGroup.rotation.x = Math.cos(t * 1.5) * 0.03;

    let targetHgHeadYaw = Math.sin(t * 0.7) * 0.15;
    if (this.screen === 'playing' && distToHg < 9.5) {
      const dx = this.playerPos.x - this.world.highGnomePos.x;
      const dz = this.playerPos.z - this.world.highGnomePos.z;
      const worldAngle = Math.atan2(dx, dz);
      let rel = worldAngle - hg.group.rotation.y;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      targetHgHeadYaw = THREE.MathUtils.clamp(rel, -1.05, 1.05);
    }
    hg.headGroup.rotation.y = THREE.MathUtils.damp(hg.headGroup.rotation.y, targetHgHeadYaw, 6, dt);

    const gesturing = this.highGnomeGestureTimer > 0 || (this.screen === 'playing' && distToHg < 5.5);
    const gestureL = gesturing ? -0.55 + Math.sin(t * 5.2) * 0.35 : Math.sin(t * 1.4) * 0.06;
    const gestureR = gesturing ? -0.45 + Math.cos(t * 4.6) * 0.28 : Math.cos(t * 1.3) * 0.05;
    hg.leftArm.rotation.x = THREE.MathUtils.damp(hg.leftArm.rotation.x, gestureL, 8, dt);
    hg.rightArm.rotation.x = THREE.MathUtils.damp(hg.rightArm.rotation.x, gestureR, 8, dt);

    if (this.world.droneDockMesh) {
      this.world.droneDockMesh.rotation.y = t * 0.9;
    }
    this.world.companionRigs.forEach((comp, idx) => {
      const phase = idx * 2.1;
      const rig = comp.rig;
      const b = Math.sin(t * 2.5 + phase);
      rig.torsoGroup.scale.y = 1 + b * 0.024;
      rig.torsoGroup.position.y = b * 0.018;
      rig.beard.rotation.x = Math.sin(t * 2.5 + phase - 0.5) * 0.04;
      rig.hatGroup.rotation.z = Math.sin(t * 2.1 + phase) * 0.05;

      const dist = this.playerPos.distanceTo(comp.basePos);
      let headYaw = Math.sin(t * 0.9 + phase) * 0.25;
      let waveZ = 0;
      let waveX = Math.sin(t * 1.6 + phase) * 0.08;
      if (this.screen === 'playing' && dist < 8.5) {
        const worldAngle = Math.atan2(this.playerPos.x - comp.basePos.x, this.playerPos.z - comp.basePos.z);
        let rel = worldAngle - comp.baseYaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        headYaw = THREE.MathUtils.clamp(rel, -1.0, 1.0);
        if (dist < 6.0) {
          waveX = -2.2;
          waveZ = Math.sin(t * 8.5 + phase) * 0.32 - 0.2;
        }
      }
      rig.headGroup.rotation.y = THREE.MathUtils.damp(rig.headGroup.rotation.y, headYaw, 6, dt);
      rig.rightArm.rotation.x = THREE.MathUtils.damp(rig.rightArm.rotation.x, waveX, 9, dt);
      rig.rightArm.rotation.z = THREE.MathUtils.damp(rig.rightArm.rotation.z, waveZ, 9, dt);
      rig.leftArm.rotation.x = THREE.MathUtils.damp(rig.leftArm.rotation.x, Math.cos(t * 1.5 + phase) * 0.07, 8, dt);
    });
  }

  private moveFlyingBody(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    dt: number
  ): void {
    const bounds = this.getWorldBounds();
    const isHit = (x: number, y: number, z: number) => {
      for (const c of this.world.colliders) {
        if (c.isFloorLike) continue;
        if (
          x + radius > c.minX &&
          x - radius < c.maxX &&
          z + radius > c.minZ &&
          z - radius < c.maxZ &&
          y + height > c.minY + 0.04 &&
          y < c.maxY - 0.04
        ) {
          return c;
        }
      }
      return null;
    };

    pos.x += vel.x * dt;
    let c = isHit(pos.x, pos.y, pos.z);
    if (c) {
      pos.x = vel.x > 0 ? c.minX - radius : c.maxX + radius;
      vel.x *= -0.15;
    }

    pos.z += vel.z * dt;
    c = isHit(pos.x, pos.y, pos.z);
    if (c) {
      pos.z = vel.z > 0 ? c.minZ - radius : c.maxZ + radius;
      vel.z *= -0.15;
    }

    pos.y += vel.y * dt;
    c = isHit(pos.x, pos.y, pos.z);
    if (c) {
      if (vel.y <= 0) pos.y = c.maxY;
      else pos.y = c.minY - height;
      vel.y = 0;
    }

    if (pos.y < 0) {
      pos.y = 0;
      vel.y = 0;
    }
    const maxY = pos.z <= 42.5 ? 24.4 - height : 34.0;
    if (pos.y > maxY) {
      pos.y = maxY;
      vel.y = Math.min(0, vel.y);
    }
    pos.x = THREE.MathUtils.clamp(pos.x, bounds.minX, bounds.maxX);
    pos.z = THREE.MathUtils.clamp(pos.z, bounds.minZ, bounds.maxZ);
  }

  private updateMiniCopterPhysics(dt: number): void {
    const moveF = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const moveR = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const moveUp = (this.keys['Space'] ? 1 : 0) - (this.keys['KeyC'] || this.keys['ControlLeft'] ? 1 : 0);
    const turbo = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const maxSpeed = turbo ? 22.5 : 15.5;

    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _v1.set(0, 0, 0).addScaledVector(_forward, moveF).addScaledVector(_right, moveR);
    if (_v1.lengthSq() > 0.001) _v1.normalize();

    this.copterVel.x = THREE.MathUtils.damp(this.copterVel.x, _v1.x * maxSpeed, 5.5, dt);
    this.copterVel.z = THREE.MathUtils.damp(this.copterVel.z, _v1.z * maxSpeed, 5.5, dt);
    const hoverVy = moveUp !== 0 ? moveUp * (turbo ? 12.5 : 9.2) : Math.sin(this.elapsedTime * 3.1) * 0.35;
    this.copterVel.y = THREE.MathUtils.damp(this.copterVel.y, hoverVy, 7.5, dt);

    this.moveFlyingBody(this.copterPos, this.copterVel, 1.05, 1.85, dt);
    this.playerPos.set(this.copterPos.x, this.copterPos.y + 0.5, this.copterPos.z);

    let yawDiff = normalizeAngle(this.yaw - this.copterYaw);
    this.copterYaw = normalizeAngle(this.copterYaw + yawDiff * Math.min(1, dt * 8));

    this.copterRotorSpin = THREE.MathUtils.damp(this.copterRotorSpin, turbo ? 36 : 26, 8, dt);
    this.miniCopter.mainRotor.rotation.y += this.copterRotorSpin * dt;
    this.miniCopter.tailRotor.rotation.x += this.copterRotorSpin * 1.7 * dt;
    this.miniCopter.pilotDecoy.visible = true;
    this.miniCopter.searchLightCone.visible = true;

    this.miniCopter.group.position.copy(this.copterPos);
    this.miniCopter.group.rotation.y = this.copterYaw;
    this.miniCopter.bodyGroup.rotation.x = THREE.MathUtils.damp(
      this.miniCopter.bodyGroup.rotation.x,
      -moveF * (turbo ? 0.28 : 0.19),
      8,
      dt
    );
    this.miniCopter.bodyGroup.rotation.z = THREE.MathUtils.damp(
      this.miniCopter.bodyGroup.rotation.z,
      -moveR * (turbo ? 0.25 : 0.16),
      8,
      dt
    );

    this.vehicleAudioTimer += dt;
    if (this.vehicleAudioTimer >= 0.085) {
      this.vehicleAudioTimer = 0;
      const spd = Math.hypot(this.copterVel.x, this.copterVel.z) / 22.5;
      this.sound.playCopterTick(false, spd);
    }
  }

  private updateParkedMiniCopter(dt: number): void {
    let remotePilot: NetPlayerState | null = null;
    if (this.mpActive) {
      for (const [id, p] of this.mpPlayers) {
        if (id !== this.mpMyId && p.inCopter) {
          remotePilot = p;
          break;
        }
      }
    }

    if (remotePilot) {
      const target = _v1.set(remotePilot.x, Math.max(0, remotePilot.y - 0.45), remotePilot.z);
      this.copterPos.lerp(target, 1 - Math.exp(-15 * dt));
      this.copterYaw = remotePilot.yaw;
      this.copterRotorSpin = 28;
      this.miniCopter.pilotDecoy.visible = true;
      this.miniCopter.searchLightCone.visible = true;
    } else {
      this.copterRotorSpin = THREE.MathUtils.damp(this.copterRotorSpin, 0, 3.5, dt);
      this.miniCopter.pilotDecoy.visible = false;
      this.miniCopter.searchLightCone.visible = false;
    }

    this.miniCopter.mainRotor.rotation.y += this.copterRotorSpin * dt;
    this.miniCopter.tailRotor.rotation.x += this.copterRotorSpin * 1.7 * dt;
    this.miniCopter.group.position.copy(this.copterPos);
    this.miniCopter.group.rotation.y = this.copterYaw;
    this.miniCopter.bodyGroup.rotation.x = THREE.MathUtils.damp(this.miniCopter.bodyGroup.rotation.x, 0, 8, dt);
    this.miniCopter.bodyGroup.rotation.z = THREE.MathUtils.damp(this.miniCopter.bodyGroup.rotation.z, 0, 8, dt);
  }

  private updateMavicDronePhysics(dt: number): void {
    this.droneBattery = Math.max(0, this.droneBattery - 3.0 * dt);
    if (this.droneBattery <= 0) {
      this.toggleMavicDrone();
      this.showNotification('Батарея Мавик-Дрона разряжена! Возврат на подзарядку.');
      return;
    }

    const moveF = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const moveR = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const moveUp = (this.keys['Space'] ? 1 : 0) - (this.keys['KeyC'] || this.keys['ControlLeft'] ? 1 : 0);
    const sport = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed = sport ? 18.0 : 12.0;

    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _v1.set(0, 0, 0).addScaledVector(_forward, moveF).addScaledVector(_right, moveR);
    if (_v1.lengthSq() > 0.001) _v1.normalize();

    this.droneVel.x = THREE.MathUtils.damp(this.droneVel.x, _v1.x * speed, 10, dt);
    this.droneVel.z = THREE.MathUtils.damp(this.droneVel.z, _v1.z * speed, 10, dt);
    this.droneVel.y = THREE.MathUtils.damp(this.droneVel.y, moveUp * 9.5, 10, dt);

    this.moveFlyingBody(this.dronePos, this.droneVel, 0.36, 0.32, dt);

    this.mavicDrone.group.visible = true;
    this.mavicDrone.group.position.copy(this.dronePos);
    this.mavicDrone.group.rotation.y = this.yaw;
    this.mavicDrone.bodyGroup.rotation.x = THREE.MathUtils.damp(this.mavicDrone.bodyGroup.rotation.x, -moveF * 0.24, 12, dt);
    this.mavicDrone.bodyGroup.rotation.z = THREE.MathUtils.damp(this.mavicDrone.bodyGroup.rotation.z, -moveR * 0.24, 12, dt);
    this.mavicDrone.gimbal.rotation.x = this.pitch;
    this.mavicDrone.rotors.forEach((r, idx) => {
      r.rotation.y += (idx % 2 === 0 ? 1 : -1) * 44 * dt;
    });

    this.vehicleAudioTimer += dt;
    if (this.vehicleAudioTimer >= 0.075) {
      this.vehicleAudioTimer = 0;
      const spd = Math.hypot(this.droneVel.x, this.droneVel.z) / 18.0;
      this.sound.playCopterTick(true, spd);
    }
  }

  private updateTreeWithEyesHub(dt: number): void {
    const rig = this.world.treeWithEyesRig;
    rig.playCrystal.rotation.y += dt * 1.9;
    rig.playCrystal.position.y = 2.38 + Math.sin(this.elapsedTime * 3.0) * 0.14;

    if (this.treeBlinkProgress > 0) {
      this.treeBlinkProgress += dt / 0.24;
      if (this.treeBlinkProgress >= 1) {
        this.treeBlinkProgress = 0;
        rig.leftLid.rotation.x = -0.85;
        rig.rightLid.rotation.x = -0.85;
      } else {
        const blink = Math.sin(this.treeBlinkProgress * Math.PI);
        const lidAngle = THREE.MathUtils.lerp(-0.85, 0.22, blink);
        rig.leftLid.rotation.x = lidAngle;
        rig.rightLid.rotation.x = lidAngle;
      }
    } else {
      this.treeBlinkTimer -= dt;
      if (this.treeBlinkTimer <= 0) {
        this.treeBlinkTimer = 2.6 + Math.random() * 2.8;
        this.treeBlinkProgress = 0.01;
      }
    }

    const lookX = this.inTreeHub ? this.playerPos.x : this.world.hubSpawnPos.x;
    const lookY = this.inTreeHub ? Math.max(0.8, this.playerPos.y + 1.1) : 1.5;
    const lookZ = this.inTreeHub ? this.playerPos.z : this.world.hubSpawnPos.z;
    rig.leftEyePivot.lookAt(lookX, lookY, lookZ);
    rig.rightEyePivot.lookAt(lookX, lookY, lookZ);

    this.nearPlayButton = this.inTreeHub && this.playerPos.distanceTo(this.world.playButtonPos) < 4.5;
  }

  private moveGroundedActor(
    pos: THREE.Vector3,
    dx: number,
    dz: number,
    radius: number,
    minBlockY: number,
    maxBlockY: number
  ): { hitX: boolean; hitZ: boolean } {
    let hitX = false;
    let hitZ = false;
    const isSolid = (c: AABBCollider) =>
      !c.isFloorLike && c.maxY > minBlockY && c.minY < maxBlockY;

    pos.x += dx;
    for (const c of this.world.colliders) {
      if (!isSolid(c)) continue;
      if (
        pos.x + radius > c.minX &&
        pos.x - radius < c.maxX &&
        pos.z + radius > c.minZ &&
        pos.z - radius < c.maxZ
      ) {
        hitX = true;
        if (dx > 0) pos.x = c.minX - radius;
        else if (dx < 0) pos.x = c.maxX + radius;
        else {
          const pl = Math.abs(pos.x + radius - c.minX);
          const pr = Math.abs(c.maxX - (pos.x - radius));
          pos.x = pl < pr ? c.minX - radius : c.maxX + radius;
        }
      }
    }

    pos.z += dz;
    for (const c of this.world.colliders) {
      if (!isSolid(c)) continue;
      if (
        pos.x + radius > c.minX &&
        pos.x - radius < c.maxX &&
        pos.z + radius > c.minZ &&
        pos.z - radius < c.maxZ
      ) {
        hitZ = true;
        if (dz > 0) pos.z = c.minZ - radius;
        else if (dz < 0) pos.z = c.maxZ + radius;
        else {
          const pf = Math.abs(pos.z + radius - c.minZ);
          const pb = Math.abs(c.maxZ - (pos.z - radius));
          pos.z = pf < pb ? c.minZ - radius : c.maxZ + radius;
        }
      }
    }

    return { hitX, hitZ };
  }

  private updateGnomeCarPhysics(dt: number): void {
    const moveF = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const steerIn = (this.keys['KeyA'] ? 1 : 0) - (this.keys['KeyD'] ? 1 : 0);
    const brake = Boolean(this.keys['Space']);
    const turbo = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

    const maxFwd = turbo ? 27.5 : 19.5;
    const maxRev = -10.5;

    if (brake) {
      this.carSpeed = THREE.MathUtils.damp(this.carSpeed, 0, 9.5, dt);
    } else if (moveF > 0) {
      const accel = turbo ? 36 : 24;
      this.carSpeed = Math.min(maxFwd, this.carSpeed + accel * dt);
    } else if (moveF < 0) {
      this.carSpeed = Math.max(maxRev, this.carSpeed - 22 * dt);
    } else {
      this.carSpeed = THREE.MathUtils.damp(this.carSpeed, 0, 3.8, dt);
    }

    this.carSteer = THREE.MathUtils.damp(this.carSteer, steerIn, 12, dt);
    if (Math.abs(this.carSpeed) > 0.35) {
      const dirSign = this.carSpeed >= 0 ? 1 : -1;
      const turnRate = 2.25 * Math.min(1, Math.abs(this.carSpeed) / 4.2);
      this.carYaw = normalizeAngle(this.carYaw + this.carSteer * turnRate * dirSign * dt);
    }

    const fwdX = -Math.sin(this.carYaw);
    const fwdZ = -Math.cos(this.carYaw);
    const stepX = fwdX * this.carSpeed * dt;
    const stepZ = fwdZ * this.carSpeed * dt;

    const { hitX, hitZ } = this.moveGroundedActor(this.carPos, stepX, stepZ, 1.38, 0.35, 2.2);
    const bounds = this.getWorldBounds();
    this.carPos.x = THREE.MathUtils.clamp(this.carPos.x, bounds.minX + 1.5, bounds.maxX - 1.5);
    this.carPos.z = THREE.MathUtils.clamp(this.carPos.z, bounds.minZ + 1.5, bounds.maxZ - 1.5);
    if (hitX || hitZ) {
      if (Math.abs(this.carSpeed) > 8) {
        this.cameraShake = Math.max(this.cameraShake, 0.14);
        this.sound.playTrashCrash();
      }
      this.carSpeed *= -0.22;
    }

    // Visual wheel spin, steering & suspension tilt
    this.gnomeCar.group.position.copy(this.carPos);
    this.gnomeCar.group.rotation.y = this.carYaw;
    this.gnomeCar.steeringWheel.rotation.z = this.carSteer * 1.1;
    this.gnomeCar.frontPivots.forEach((fp) => {
      fp.rotation.y = this.carSteer * 0.45;
    });
    const wheelDelta = (this.carSpeed * dt) / 0.36;
    this.gnomeCar.wheels.forEach((w) => {
      w.rotation.x -= wheelDelta;
    });
    this.gnomeCar.bodyGroup.rotation.z = THREE.MathUtils.damp(
      this.gnomeCar.bodyGroup.rotation.z,
      -this.carSteer * Math.min(0.09, Math.abs(this.carSpeed) * 0.004),
      10,
      dt
    );
    this.gnomeCar.bodyGroup.rotation.x = THREE.MathUtils.damp(
      this.gnomeCar.bodyGroup.rotation.x,
      moveF * -0.04,
      8,
      dt
    );
    this.gnomeCar.driverDummy.visible = true;
    this.gnomeCar.passengerDummy.visible = Boolean(this.carPassengerId);

    this.gnomeCar.group.updateMatrixWorld(true);
    this.gnomeCar.driverSlot.getWorldPosition(_v1);
    this.playerPos.set(_v1.x, _v1.y - 0.12, _v1.z);
    this.playerVel.set(0, 0, 0);

    // High-speed ramming damage!
    if (Math.abs(this.carSpeed) > 8.5 && !this.inTreeHub) {
      for (const ins of this.world.insects) {
        if (ins.dead) continue;
        if (ins.position.distanceTo(this.carPos) < 2.2) {
          if (this.mpActive) {
            this.mpClient.send({
              type: 'insect:hit',
              insectId: ins.id,
              damage: 4,
              vx: fwdX * 14,
              vy: 6,
              vz: fwdZ * 14,
            });
          } else {
            ins.hp = 0;
            ins.dead = true;
            ins.deathTimer = 1.1;
            this.shinies += 6;
            this.scrap += 1;
            this.sound.playStickHit();
            this.spawnBurst(ins.position, 6, this.sparkMat);
          }
        }
      }

      if (!this.humanDead && Math.hypot(this.humanPos.x - this.carPos.x, this.humanPos.z - this.carPos.z) < 3.1) {
        this.sound.playTrashCrash();
        this.cameraShake = Math.max(this.cameraShake, 0.28);
        this.spawnBurst(this.carPos.clone().setY(1.2), 12, this.sparkMat);
        this.carSpeed *= -0.45;
        this.damageHuman(28);
      }

      if (this.dogStunTimer <= 0 && this.dogPos.distanceTo(this.carPos) < 2.4) {
        this.dogStunTimer = 4.0;
        this.dogAlert = false;
        this.sound.playDogBark();
        this.spawnBurst(this.dogPos.clone().setY(0.9), 8, this.sparkMat);
        this.showNotification('Собака сбита с толку машинкой!');
      }

      if (this.catStunTimer <= 0 && this.catPos.distanceTo(this.carPos) < 2.2) {
        this.catStunTimer = 4.0;
        this.catAlert = false;
        this.sound.playCatMeow();
        this.spawnBurst(this.catPos.clone().setY(0.7), 8, this.sparkMat);
      }
    }

    if (this.mpActive) {
      this.carSyncTimer += dt;
      if (this.carSyncTimer >= 0.05) {
        this.carSyncTimer = 0;
        this.mpClient.send({
          type: 'car:update',
          x: Number(this.carPos.x.toFixed(2)),
          y: Number(this.carPos.y.toFixed(2)),
          z: Number(this.carPos.z.toFixed(2)),
          yaw: Number(this.carYaw.toFixed(3)),
          speed: Number(this.carSpeed.toFixed(2)),
          steer: Number(this.carSteer.toFixed(2)),
        });
      }
    }
  }

  private updateGnomeCarPassive(dt: number): void {
    const hasRemoteDriver = this.mpActive && this.carDriverId && this.carDriverId !== this.mpMyId;
    if (hasRemoteDriver) {
      this.carPos.lerp(this.carTargetPos, 1 - Math.exp(-15 * dt));
      const diff = normalizeAngle(this.carTargetYaw - this.carYaw);
      this.carYaw = normalizeAngle(this.carYaw + diff * Math.min(1, dt * 15));
    } else {
      this.carSpeed = THREE.MathUtils.damp(this.carSpeed, 0, 5.0, dt);
      this.carSteer = THREE.MathUtils.damp(this.carSteer, 0, 8.0, dt);
    }

    this.gnomeCar.group.position.copy(this.carPos);
    this.gnomeCar.group.rotation.y = this.carYaw;
    this.gnomeCar.steeringWheel.rotation.z = this.carSteer * 1.1;
    this.gnomeCar.frontPivots.forEach((fp) => {
      fp.rotation.y = this.carSteer * 0.45;
    });
    const wheelDelta = (this.carSpeed * dt) / 0.36;
    this.gnomeCar.wheels.forEach((w) => {
      w.rotation.x -= wheelDelta;
    });
    this.gnomeCar.driverDummy.visible = Boolean(this.carDriverId);
    this.gnomeCar.passengerDummy.visible = Boolean(this.carPassengerId) && this.inCarSeat !== 2;
  }

  private updateGiantBossGnomeAI(dt: number): void {
    if (!this.bossActive || this.inTreeHub) {
      this.giantBossGnome.group.visible = false;
      return;
    }
    this.giantBossGnome.group.visible = true;

    const allTargets = this.getAlivePlayerTargets().filter((t) => !t.inBurrow);
    let bestTarget: (typeof allTargets)[number] | null = null;
    let bestDist = Infinity;
    for (const t of allTargets) {
      const d = Math.hypot(t.pos.x - this.bossPos.x, t.pos.z - this.bossPos.z);
      if (d < bestDist) {
        bestDist = d;
        bestTarget = t;
      }
    }

    const goal = bestTarget ? bestTarget.pos : this.world.frontDoorPos;
    let steerGoal = goal;
    const bossOutside = this.bossPos.z > 42.5;
    const goalOutside = goal.z > 42.5;
    if (bossOutside && !goalOutside) {
      steerGoal = this.world.porchTargetPos;
    } else if (!bossOutside && !goalOutside && !this.hasHumanWallClearance(this.bossPos, goal)) {
      const path = this.findHousePath(this.bossPos, goal);
      for (const wp of path) {
        if (Math.hypot(wp.x - this.bossPos.x, wp.z - this.bossPos.z) > 2.2) {
          steerGoal = wp;
          break;
        }
      }
    }

    _v1.set(steerGoal.x - this.bossPos.x, 0, steerGoal.z - this.bossPos.z);
    const distSteer = _v1.length();
    let legSwing = 0;

    if (distSteer > 0.6) {
      _v1.normalize();
      const desiredYaw = Math.atan2(_v1.x, _v1.z);
      const diff = normalizeAngle(desiredYaw - this.bossYaw);
      this.bossYaw = normalizeAngle(this.bossYaw + diff * Math.min(1, dt * 6.5));

      const bossSpeed = bestTarget ? 11.8 : 7.5;
      const step = bossSpeed * dt;
      const { hitX, hitZ } = this.moveGroundedActor(this.bossPos, _v1.x * step, _v1.z * step, 1.95, 2.2, 16.5);
      if (hitZ && Math.abs(_v1.x) < 0.35) {
        this.moveGroundedActor(this.bossPos, (Math.sin(this.elapsedTime * 2) >= 0 ? 1 : -1) * step * 0.7, 0, 1.95, 2.2, 16.5);
      } else if (hitX && Math.abs(_v1.z) < 0.35) {
        this.moveGroundedActor(this.bossPos, 0, (Math.cos(this.elapsedTime * 2) >= 0 ? 1 : -1) * step * 0.7, 1.95, 2.2, 16.5);
      }

      const bounds = this.getWorldBounds();
      this.bossPos.x = THREE.MathUtils.clamp(this.bossPos.x, bounds.minX + 2, bounds.maxX - 2);
      this.bossPos.z = THREE.MathUtils.clamp(this.bossPos.z, -53, 70);

      this.bossWalkPhase += dt * bossSpeed * 0.75;
      legSwing = Math.sin(this.bossWalkPhase) * 0.56;

      const stepHalf = Math.floor(this.bossWalkPhase / Math.PI);
      if (stepHalf !== this.bossLastStepHalf) {
        this.bossLastStepHalf = stepHalf;
        const dLocal = this.playerPos.distanceTo(this.bossPos);
        if (dLocal < 46) {
          this.sound.playBossStomp();
          this.cameraShake = Math.max(this.cameraShake, Math.max(0, (1 - dLocal / 28) * 0.24));
        }
      }
    }

    // Hammer smash attack against local gnome
    if (
      !this.isDowned &&
      !this.isPointInBurrow(this.playerPos.x, this.playerPos.z) &&
      this.bossAttackCooldown <= 0
    ) {
      const distLocal = Math.hypot(this.playerPos.x - this.bossPos.x, this.playerPos.z - this.bossPos.z);
      if (distLocal < 4.2 && this.playerPos.y < 10.5) {
        this.bossAttackCooldown = 1.65;
        this.bossSwipeTimer = 0.55;
        this.sound.playBossRoar();
        this.damagePlayer(34, 'БОЛЬШОЙ ГНОМ сокрушил тебя молотом!');
      }
    }

    this.applyGiantBossGnomePose(dt, legSwing);
  }

  private updateGiantBossGnomeClientInterpolated(dt: number): void {
    if (!this.bossActive || this.inTreeHub) {
      this.giantBossGnome.group.visible = false;
      return;
    }
    this.giantBossGnome.group.visible = true;
    const prevX = this.bossPos.x;
    const prevZ = this.bossPos.z;
    this.bossPos.lerp(this.bossTargetPos, 1 - Math.exp(-14 * dt));
    const diff = normalizeAngle(this.bossTargetYaw - this.bossYaw);
    this.bossYaw = normalizeAngle(this.bossYaw + diff * Math.min(1, dt * 14));

    const speed = Math.hypot(this.bossPos.x - prevX, this.bossPos.z - prevZ) / Math.max(dt, 0.001);
    let legSwing = 0;
    if (speed > 0.6) {
      this.bossWalkPhase += dt * Math.min(speed, 13) * 0.75;
      legSwing = Math.sin(this.bossWalkPhase) * 0.56;
    }
    this.applyGiantBossGnomePose(dt, legSwing);
  }

  private applyGiantBossGnomePose(dt: number, legSwing: number): void {
    const boss = this.giantBossGnome;
    boss.group.position.copy(this.bossPos);
    boss.group.rotation.y = this.bossYaw;
    boss.leftLeg.rotation.x = THREE.MathUtils.damp(boss.leftLeg.rotation.x, legSwing, 12, dt);
    boss.rightLeg.rotation.x = THREE.MathUtils.damp(boss.rightLeg.rotation.x, -legSwing, 12, dt);
    boss.leftArm.rotation.x = THREE.MathUtils.damp(boss.leftArm.rotation.x, -legSwing * 0.65, 10, dt);

    const targetRightArmX =
      this.bossSwipeTimer > 0
        ? -2.2 * Math.sin((1 - this.bossSwipeTimer / 0.55) * Math.PI)
        : -0.45 + legSwing * 0.55;
    boss.rightArm.rotation.x = THREE.MathUtils.damp(boss.rightArm.rotation.x, targetRightArmX, 14, dt);
    boss.torsoGroup.position.y = 4.78 + Math.abs(legSwing) * 0.35;
    boss.alertBadge.rotation.y += dt * 4.2;
  }

  private updateYardDogAI(dt: number): void {
    if (this.inTreeHub) {
      this.yardDog.group.position.copy(this.dogPos);
      this.yardDog.group.rotation.y = this.dogYaw;
      return;
    }

    const mx = (vx: number) => (this.world.house.mirrorX ? 56 - vx : vx);
    let moveTarget: THREE.Vector3 | null = null;
    let speed = 5.4;

    if (this.dogStunTimer > 0) {
      this.dogAlert = false;
      moveTarget = this.world.doghousePos;
      speed = 11.5;
    } else {
      const yardTargets = this.getAlivePlayerTargets().filter((t) => !t.inBurrow && !t.isHidden && t.pos.z > 43);
      let closest: (typeof yardTargets)[number] | null = null;
      let closestDist = 17.5;
      for (const t of yardTargets) {
        const d = t.pos.distanceTo(this.dogPos);
        if (d < closestDist) {
          closestDist = d;
          closest = t;
        }
      }

      if (closest) {
        if (!this.dogAlert && this.dogBarkTimer <= 0) {
          this.dogBarkTimer = 2.4;
          this.sound.playDogBark();
        }
        this.dogAlert = true;
        moveTarget = closest.pos;
        speed = 10.8;

        if (
          closest.id === this.getLocalPlayerId() &&
          closestDist < 2.2 &&
          this.dogAttackCooldown <= 0 &&
          this.inCarSeat === 0 &&
          !this.inMiniCopter
        ) {
          this.dogAttackCooldown = 1.4;
          this.sound.playDogBark();
          this.damagePlayer(16, 'Дворовая собака укусила гнома!');
          if (Math.random() < 0.55) {
            _v3.copy(this.playerPos).sub(this.dogPos).setY(0);
            this.applyRandomDismemberment(false, _v3);
          }
        }
      } else {
        this.dogAlert = false;
        if (Math.hypot(this.dogPatrolTarget.x - this.dogPos.x, this.dogPatrolTarget.z - this.dogPos.z) < 1.8) {
          this.dogPatrolTarget.set(
            mx(8 + Math.random() * 52),
            0,
            46 + Math.random() * 20
          );
        }
        moveTarget = this.dogPatrolTarget;
      }
    }

    let movedSpeed = 0;
    if (moveTarget) {
      _v1.set(moveTarget.x - this.dogPos.x, 0, moveTarget.z - this.dogPos.z);
      const dist = _v1.length();
      if (dist > 0.7) {
        _v1.normalize();
        const desiredYaw = Math.atan2(_v1.x, _v1.z);
        const diff = normalizeAngle(desiredYaw - this.dogYaw);
        this.dogYaw = normalizeAngle(this.dogYaw + diff * Math.min(1, dt * 8.5));
        const step = speed * dt;
        this.moveGroundedActor(this.dogPos, _v1.x * step, _v1.z * step, 0.75, 0.2, 2.5);
        const minYardX = this.world.house.mirrorX ? -28 : -10;
        const maxYardX = this.world.house.mirrorX ? 66 : 84;
        this.dogPos.x = THREE.MathUtils.clamp(this.dogPos.x, minYardX, maxYardX);
        this.dogPos.z = THREE.MathUtils.clamp(this.dogPos.z, 44.5, 69);
        movedSpeed = speed;
      }
    }

    this.applyDogRigPose(dt, movedSpeed);
  }

  private updateHouseCatAI(dt: number): void {
    if (this.inTreeHub) {
      this.houseCat.group.position.copy(this.catPos);
      this.houseCat.group.rotation.y = this.catYaw;
      return;
    }

    const mx = (vx: number) => (this.world.house.mirrorX ? 56 - vx : vx);
    let moveTarget: THREE.Vector3 | null = null;
    let speed = 5.0;

    if (this.catStunTimer > 0) {
      this.catAlert = false;
      moveTarget = _v2.set(mx(74), 0, -14);
      speed = 12.0;
    } else {
      const indoorTargets = this.getAlivePlayerTargets().filter(
        (t) => !t.inBurrow && !t.isHidden && !t.isOutside
      );
      let closest: (typeof indoorTargets)[number] | null = null;
      let closestDist = 15.0;
      for (const t of indoorTargets) {
        const d = t.pos.distanceTo(this.catPos);
        if (d < closestDist) {
          closestDist = d;
          closest = t;
        }
      }

      if (closest) {
        if (!this.catAlert && this.catMeowTimer <= 0) {
          this.catMeowTimer = 2.6;
          this.sound.playCatMeow();
        }
        this.catAlert = true;
        moveTarget = closest.pos;
        speed = 11.4;

        if (
          closest.id === this.getLocalPlayerId() &&
          closestDist < 1.9 &&
          this.catAttackCooldown <= 0 &&
          this.inCarSeat === 0 &&
          !this.inMiniCopter
        ) {
          this.catAttackCooldown = 1.3;
          this.sound.playCatMeow();
          this.damagePlayer(12, 'Домашний кот поцарапал гнома!');
          if (Math.random() < 0.45) {
            _v3.copy(this.playerPos).sub(this.catPos).setY(0);
            this.applyRandomDismemberment(false, _v3);
          }
        }
      } else {
        this.catAlert = false;
        if (Math.hypot(this.catPatrolTarget.x - this.catPos.x, this.catPatrolTarget.z - this.catPos.z) < 1.8) {
          const wp = this.world.patrolWaypoints[Math.floor(Math.random() * this.world.patrolWaypoints.length)];
          this.catPatrolTarget.set(wp.x, 0, Math.min(34, wp.z));
        }
        moveTarget = this.catPatrolTarget;
      }
    }

    let movedSpeed = 0;
    if (moveTarget) {
      _v1.set(moveTarget.x - this.catPos.x, 0, moveTarget.z - this.catPos.z);
      const dist = _v1.length();
      if (dist > 0.7) {
        _v1.normalize();
        const desiredYaw = Math.atan2(_v1.x, _v1.z);
        const diff = normalizeAngle(desiredYaw - this.catYaw);
        this.catYaw = normalizeAngle(this.catYaw + diff * Math.min(1, dt * 10));
        const step = speed * dt;
        this.moveGroundedActor(this.catPos, _v1.x * step, _v1.z * step, 0.55, 0.2, 2.5);
        const minCatX = this.world.house.mirrorX ? -28 : -34;
        const maxCatX = this.world.house.mirrorX ? 90 : 84;
        this.catPos.x = THREE.MathUtils.clamp(this.catPos.x, minCatX, maxCatX);
        this.catPos.z = THREE.MathUtils.clamp(this.catPos.z, -52, 38);
        movedSpeed = speed;
      }
    }

    this.applyCatRigPose(dt, movedSpeed);
  }

  private updatePetsClientInterpolated(dt: number): void {
    const prevDogX = this.dogPos.x;
    const prevDogZ = this.dogPos.z;
    this.dogPos.lerp(this.dogTargetPos, 1 - Math.exp(-14 * dt));
    this.dogYaw = normalizeAngle(this.dogYaw + normalizeAngle(this.dogTargetYaw - this.dogYaw) * Math.min(1, dt * 14));
    const dogSpd = Math.hypot(this.dogPos.x - prevDogX, this.dogPos.z - prevDogZ) / Math.max(dt, 0.001);
    this.applyDogRigPose(dt, dogSpd);

    const prevCatX = this.catPos.x;
    const prevCatZ = this.catPos.z;
    this.catPos.lerp(this.catTargetPos, 1 - Math.exp(-14 * dt));
    this.catYaw = normalizeAngle(this.catYaw + normalizeAngle(this.catTargetYaw - this.catYaw) * Math.min(1, dt * 14));
    const catSpd = Math.hypot(this.catPos.x - prevCatX, this.catPos.z - prevCatZ) / Math.max(dt, 0.001);
    this.applyCatRigPose(dt, catSpd);
  }

  private applyDogRigPose(dt: number, speed: number): void {
    const dog = this.yardDog;
    dog.group.position.copy(this.dogPos);
    dog.group.rotation.y = this.dogYaw;
    if (speed > 0.5) {
      this.dogWalkPhase += dt * Math.min(speed, 14) * 1.45;
      const sw = Math.sin(this.dogWalkPhase) * 0.62;
      dog.legs[0].rotation.x = sw;
      dog.legs[1].rotation.x = -sw;
      dog.legs[2].rotation.x = -sw;
      dog.legs[3].rotation.x = sw;
    } else {
      dog.legs.forEach((l) => {
        l.rotation.x = THREE.MathUtils.damp(l.rotation.x, 0, 10, dt);
      });
    }
    dog.tail.rotation.z = Math.sin(this.elapsedTime * (this.dogAlert ? 14 : 7)) * 0.45;
  }

  private applyCatRigPose(dt: number, speed: number): void {
    const cat = this.houseCat;
    cat.group.position.copy(this.catPos);
    cat.group.rotation.y = this.catYaw;
    if (speed > 0.5) {
      this.catWalkPhase += dt * Math.min(speed, 14) * 1.65;
      const sw = Math.sin(this.catWalkPhase) * 0.58;
      cat.legs[0].rotation.x = sw;
      cat.legs[1].rotation.x = -sw;
      cat.legs[2].rotation.x = -sw;
      cat.legs[3].rotation.x = sw;
    } else {
      cat.legs.forEach((l) => {
        l.rotation.x = THREE.MathUtils.damp(l.rotation.x, 0, 10, dt);
      });
    }
    cat.tail.rotation.z = Math.sin(this.elapsedTime * (this.catAlert ? 9 : 3.5)) * 0.35;
  }

  private updateSeveredParts(dt: number): void {
    for (let i = this.severedParts.length - 1; i >= 0; i--) {
      const sp = this.severedParts[i];
      sp.life -= dt;
      sp.vel.y -= 28 * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);
      sp.mesh.rotation.x += sp.rotVel.x * dt;
      sp.mesh.rotation.y += sp.rotVel.y * dt;
      sp.mesh.rotation.z += sp.rotVel.z * dt;
      if (sp.mesh.position.y < 0.16) {
        sp.mesh.position.y = 0.16;
        sp.vel.y = -sp.vel.y * 0.36;
        sp.vel.x *= 0.65;
        sp.vel.z *= 0.65;
        sp.rotVel.multiplyScalar(0.5);
      }
      if (sp.life <= 0) {
        this.scene.remove(sp.mesh);
        this.severedParts.splice(i, 1);
      }
    }
  }

  private updateQuestMarkers(dt: number): void {
    const t = this.elapsedTime;
    for (let i = 0; i < this.world.props.length; i++) {
      const p = this.world.props[i];
      if (!p.questMarker) continue;
      if (p.collected || p.broken || p.tipped || p.isHeld) {
        p.questMarker.visible = false;
        continue;
      }
      const needed = this.quests.some((q) => !q.completed && q.targetCategory === p.category);
      p.questMarker.visible = needed;
      if (needed) {
        p.questMarker.position.set(
          p.mesh.position.x,
          p.mesh.position.y + p.halfHeight + 0.78 + Math.sin(t * 3.2 + i * 0.7) * 0.16,
          p.mesh.position.z
        );
        p.questMarker.rotation.y += dt * 2.4;
      }
    }
  }

  private damagePlayer(amount: number, msg: string): void {
    if (this.hurtCooldown > 0 || this.isDowned) return;
    this.hurtCooldown = 0.65;
    this.hp = Math.max(0, this.hp - amount);
    this.cameraShake = 0.25;
    this.sound.playPlayerHurt();
    this.showNotification(msg);

    // Physical dismemberment on gunshot, heavy throw, or low HP hit!
    if (amount >= 18 || this.hp <= 45) {
      _v3.copy(this.playerPos).sub(this.humanPos).setY(0);
      this.applyRandomDismemberment(amount >= 25, _v3);
    }

    if (this.hp <= 0) {
      this.applyRandomDismemberment(true);
      if (this.inMiniCopter) this.exitMiniCopter();
      if (this.inDroneMode) {
        this.inDroneMode = false;
        this.mavicDrone.group.visible = false;
      }
      if (this.mpActive && this.mpPlayers.size > 1) {
        this.isDowned = true;
        this.respawnTimer = 4.0;
        if (this.heldProp) {
          const p = this.heldProp;
          p.isHeld = false;
          this.heldProp = null;
          this.mpClient.send({
            type: 'prop:release',
            propId: p.id,
            x: p.mesh.position.x,
            y: p.mesh.position.y,
            z: p.mesh.position.z,
            rx: p.mesh.rotation.x,
            ry: p.mesh.rotation.y,
            rz: p.mesh.rotation.z,
            vx: 0,
            vy: 0,
            vz: 0,
          });
        }
        this.showNotification('Ты без сознания! Возрождение в норе через 4 сек...');
      } else {
        this.finishDay(msg.includes('Сосед') ? 'caught' : 'knocked_out');
      }
    }
    this.emitHud();
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.vel.y -= 22 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.rotation.x += dt * 7;
      pt.mesh.rotation.y += dt * 5;
      if (pt.mesh.position.y < 0.1) {
        pt.mesh.position.y = 0.1;
        pt.vel.y = -pt.vel.y * 0.3;
      }
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  // ==================== MULTIPLAYER SYNC & AVATARS ====================

  private clearRemoteAvatars(): void {
    for (const entry of this.remoteAvatars.values()) {
      this.scene.remove(entry.rig.group);
      entry.rig.nameTexture.dispose();
    }
    this.remoteAvatars.clear();
  }

  private ensureRemoteAvatar(p: NetPlayerState): RemoteAvatarEntry {
    let entry = this.remoteAvatars.get(p.id);
    if (!entry) {
      const rig = createRemoteGnomePlayerModel(p.name, p.color, this.textures);
      rig.group.position.set(p.x, p.y, p.z);
      this.scene.add(rig.group);
      entry = {
        rig,
        targetPos: new THREE.Vector3(p.x, p.y, p.z),
        curPos: new THREE.Vector3(p.x, p.y, p.z),
        targetYaw: p.yaw,
        curYaw: p.yaw,
        walkPhase: 0,
        swingTimer: 0,
        wasSwinging: false,
      };
      this.remoteAvatars.set(p.id, entry);
    }
    return entry;
  }

  private removeRemoteAvatar(playerId: string): void {
    const entry = this.remoteAvatars.get(playerId);
    if (entry) {
      this.scene.remove(entry.rig.group);
      entry.rig.nameTexture.dispose();
      this.remoteAvatars.delete(playerId);
    }
  }

  private updateRemoteAvatars(dt: number): void {
    for (const [id, p] of this.mpPlayers) {
      if (id === this.mpMyId) continue;
      const entry = this.ensureRemoteAvatar(p);
      entry.targetPos.set(p.x, p.y, p.z);
      entry.targetYaw = p.yaw;

      const prevX = entry.curPos.x;
      const prevZ = entry.curPos.z;
      entry.curPos.lerp(entry.targetPos, 1 - Math.exp(-16 * dt));

      let diff = entry.targetYaw - entry.curYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      entry.curYaw += diff * Math.min(1, dt * 16);

      // If human is currently grabbing this remote player, visually attach to human fist!
      if (this.humanGrabState !== 'none' && this.humanGrabTargetId === id) {
        this.human.group.updateMatrixWorld(true);
        this.human.grabHandAnchor.getWorldPosition(_v2);
        entry.curPos.set(_v2.x, Math.max(1.2, _v2.y - 0.8), _v2.z);
      }

      const speed = Math.hypot(entry.curPos.x - prevX, entry.curPos.z - prevZ) / Math.max(dt, 0.001);
      const rig = entry.rig;
      rig.group.position.copy(entry.curPos);
      // Note: local camera yaw=0 faces -Z while gnome model faces +Z, so rotate by yaw + Math.PI
      rig.group.rotation.y = entry.curYaw + Math.PI;

      if (p.isDowned) {
        rig.bodyRoot.rotation.z = THREE.MathUtils.damp(rig.bodyRoot.rotation.z, Math.PI / 2, 10, dt);
        rig.bodyRoot.position.y = THREE.MathUtils.damp(rig.bodyRoot.position.y, 0.35, 10, dt);
      } else {
        rig.bodyRoot.rotation.z = THREE.MathUtils.damp(rig.bodyRoot.rotation.z, 0, 12, dt);
        rig.bodyRoot.position.y = THREE.MathUtils.damp(rig.bodyRoot.position.y, 0, 12, dt);
      }

      const targetScaleY = p.isCrouching ? 0.62 : 1.0;
      rig.bodyRoot.scale.y = THREE.MathUtils.damp(rig.bodyRoot.scale.y, targetScaleY, 14, dt);

      if (speed > 0.4 && !p.isDowned) {
        entry.walkPhase += dt * Math.min(speed, 16) * 1.1;
        const swing = Math.sin(entry.walkPhase) * 0.65;
        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.leftArm.rotation.x = -swing * 0.6;
        if (entry.swingTimer <= 0) rig.rightArm.rotation.x = swing * 0.6;
      } else {
        rig.leftLeg.rotation.x = THREE.MathUtils.damp(rig.leftLeg.rotation.x, 0, 12, dt);
        rig.rightLeg.rotation.x = THREE.MathUtils.damp(rig.rightLeg.rotation.x, 0, 12, dt);
        rig.leftArm.rotation.x = THREE.MathUtils.damp(rig.leftArm.rotation.x, 0, 10, dt);
        if (entry.swingTimer <= 0) rig.rightArm.rotation.x = THREE.MathUtils.damp(rig.rightArm.rotation.x, 0, 10, dt);
      }

      rig.stickGroup.visible = p.hasStick || this.upgrades.stick;
      if (p.stickSwinging && !entry.wasSwinging) {
        entry.swingTimer = 0.24;
      }
      entry.wasSwinging = p.stickSwinging;
      if (entry.swingTimer > 0) {
        entry.swingTimer = Math.max(0, entry.swingTimer - dt);
        const sp = Math.sin((1 - entry.swingTimer / 0.24) * Math.PI);
        rig.rightArm.rotation.x = -1.6 * sp;
      }

      rig.headGroup.rotation.x = THREE.MathUtils.damp(rig.headGroup.rotation.x, -p.pitch * 0.45, 12, dt);
      rig.hatGroup.rotation.z = Math.sin(this.elapsedTime * 3 + entry.walkPhase) * 0.04;

      // Apply multiplayer dismemberment visibility, Mini-Copter & 2-Seater Car pilot hiding
      const mask = p.dismemberMask ?? 0;
      rig.bodyRoot.visible = !p.inCopter && (p.inCarSeat ?? 0) === 0;
      rig.leftArm.visible = (mask & 1) === 0;
      rig.rightArm.visible = (mask & 2) === 0;
      rig.leftLeg.visible = (mask & 4) === 0;
      rig.rightLeg.visible = (mask & 8) === 0;
      rig.hatGroup.visible = (mask & 16) === 0;
    }
  }

  private syncMultiplayerTick(dt: number): void {
    this.mpPlayerSyncTimer += dt;
    if (this.mpPlayerSyncTimer >= 0.05) {
      this.mpPlayerSyncTimer = 0;
      const myState: NetPlayerState = {
        id: this.mpMyId,
        name: this.mpPlayers.get(this.mpMyId)?.name ?? 'Гном',
        color: this.mpPlayers.get(this.mpMyId)?.color ?? 'red',
        isHost: this.mpIsHost,
        x: this.playerPos.x,
        y: this.playerPos.y,
        z: this.playerPos.z,
        yaw: this.yaw,
        pitch: this.pitch,
        isCrouching: this.isCrouching,
        isClimbing: this.isClimbing,
        isGrounded: this.isGrounded,
        hasStick: this.upgrades.stick,
        stickSwinging: this.stickSwingTimer > 0,
        heldPropId: this.heldProp?.id ?? null,
        hp: Math.ceil(this.hp),
        isDowned: this.isDowned,
        isGrabbed: this.humanGrabState !== 'none' && this.humanGrabTargetId === this.mpMyId,
        dismemberMask: this.dismemberMask,
        inCopter: this.inMiniCopter,
        inCarSeat: this.inCarSeat,
      };
      this.mpPlayers.set(this.mpMyId, myState);
      this.mpClient.send({
        type: 'player:update',
        ...myState,
      });
    }

    if (this.heldProp) {
      this.mpPropMoveTimer += dt;
      if (this.mpPropMoveTimer >= 0.065) {
        this.mpPropMoveTimer = 0;
        const p = this.heldProp;
        this.mpClient.send({
          type: 'prop:move',
          propId: p.id,
          x: p.mesh.position.x,
          y: p.mesh.position.y,
          z: p.mesh.position.z,
          rx: p.mesh.rotation.x,
          ry: p.mesh.rotation.y,
          rz: p.mesh.rotation.z,
          vx: 0,
          vy: 0,
          vz: 0,
        });
      }
    }

    if (this.mpIsHost) {
      this.mpWorldSyncTimer += dt;
      if (this.mpWorldSyncTimer >= 0.066) {
        this.mpWorldSyncTimer = 0;
        const humanPayload: NetHumanState = {
          x: this.humanPos.x,
          y: this.humanPos.y,
          z: this.humanPos.z,
          yaw: this.humanYaw,
          hp: this.humanHp,
          maxHp: this.humanMaxHp,
          dead: this.humanDead,
          alert: this.humanAlert,
          weapon: this.humanWeapon,
          grabState: this.humanGrabState,
          grabTargetId: this.humanGrabTargetId,
          aiming: this.humanRemoteAiming,
          startleTimer: this.humanStartleTimer,
          swipeTimer: this.humanSwipeTimer,
        };
        const bossPayload: NetBossGnomeState = {
          active: this.bossActive,
          x: Number(this.bossPos.x.toFixed(2)),
          y: Number(this.bossPos.y.toFixed(2)),
          z: Number(this.bossPos.z.toFixed(2)),
          yaw: Number(this.bossYaw.toFixed(2)),
          swipeTimer: Number(this.bossSwipeTimer.toFixed(2)),
          roarTimer: Number(this.bossRoarTimer.toFixed(2)),
        };
        const petsPayload: NetPetsState = {
          dog: {
            x: Number(this.dogPos.x.toFixed(2)),
            y: Number(this.dogPos.y.toFixed(2)),
            z: Number(this.dogPos.z.toFixed(2)),
            yaw: Number(this.dogYaw.toFixed(2)),
            alert: this.dogAlert,
            hitTimer: Number(this.dogStunTimer.toFixed(2)),
          },
          cat: {
            x: Number(this.catPos.x.toFixed(2)),
            y: Number(this.catPos.y.toFixed(2)),
            z: Number(this.catPos.z.toFixed(2)),
            yaw: Number(this.catYaw.toFixed(2)),
            alert: this.catAlert,
            hitTimer: Number(this.catStunTimer.toFixed(2)),
          },
        };
        const propsPayload = this.world.props
          .filter((p) => !p.collected && !p.broken && !p.isHeld)
          .map((p) => ({
            id: p.id,
            x: Number(p.mesh.position.x.toFixed(2)),
            y: Number(p.mesh.position.y.toFixed(2)),
            z: Number(p.mesh.position.z.toFixed(2)),
            rx: Number(p.mesh.rotation.x.toFixed(2)),
            ry: Number(p.mesh.rotation.y.toFixed(2)),
            rz: Number(p.mesh.rotation.z.toFixed(2)),
            vx: Number(p.velocity.x.toFixed(2)),
            vy: Number(p.velocity.y.toFixed(2)),
            vz: Number(p.velocity.z.toFixed(2)),
          }));
        const insectsPayload = this.world.insects
          .filter((ins) => !ins.dead)
          .map((ins) => ({
            id: ins.id,
            x: Number(ins.position.x.toFixed(2)),
            y: Number(ins.position.y.toFixed(2)),
            z: Number(ins.position.z.toFixed(2)),
            yaw: Number(ins.yaw.toFixed(2)),
          }));
        this.mpClient.send({
          type: 'world:sync',
          human: humanPayload,
          bossGnome: bossPayload,
          pets: petsPayload,
          props: propsPayload,
          insects: insectsPayload,
        });
      }
    }
  }

  private applyPropStateFromNet(np: NetPropState, isHeldSync = false): void {
    const p = this.world.props.find((pr) => pr.id === np.id);
    if (!p) return;

    const heldByOther = Boolean(np.heldBy && np.heldBy !== this.mpMyId);
    const heldByMe = np.heldBy === this.mpMyId;

    if (p.collected !== np.collected) {
      p.collected = np.collected;
      if (np.collected) p.mesh.visible = false;
    }
    if (p.broken !== np.broken) {
      p.broken = np.broken;
      if (np.broken) {
        p.mesh.visible = false;
        if (p.questMarker) p.questMarker.visible = false;
      }
    }
    if (p.tipped !== np.tipped) {
      p.tipped = np.tipped;
      if (np.tipped) p.mesh.rotation.z = Math.PI / 2;
    }

    if (heldByOther) {
      p.isHeld = true;
      if (this.heldProp === p) this.heldProp = null;
      p.mesh.position.set(np.x, np.y, np.z);
      p.mesh.rotation.set(np.rx, np.ry, np.rz);
    } else if (!heldByMe && !isHeldSync) {
      p.isHeld = false;
      if (!this.mpIsHost && !p.collected && !p.broken) {
        p.mesh.position.lerp(_v1.set(np.x, np.y, np.z), 0.55);
        p.mesh.rotation.set(np.rx, np.ry, np.rz);
      }
    }
  }

  private handleServerEvent(ev: ServerEvent): void {
    if (ev.type === 'room:error') {
      if (this.pendingJoinReject) {
        const rej = this.pendingJoinReject;
        this.pendingJoinResolve = null;
        this.pendingJoinReject = null;
        rej(new Error(ev.message));
      } else {
        this.showNotification(ev.message);
      }
      return;
    }

    if (ev.type === 'room:joined') {
      const r: RoomJoinedPayload['room'] = ev.room;
      this.clearRemoteAvatars();
      this.mpActive = true;
      this.mpRoomCode = r.code;
      this.mpRoomName = r.name;
      this.mpIsPublic = r.isPublic;
      this.mpMyId = ev.myId;
      this.mpIsHost = r.hostId === ev.myId;
      this.mpConnectionStatus = 'connected';
      this.day = r.day;
      this.dayStarted = r.dayStarted;
      this.inTreeHub = r.inTreeHub;
      this.timeRemaining = r.timeRemaining;
      this.summaryReason = r.summaryReason;
      this.shinies = r.shinies;
      this.scrap = r.scrap;
      this.upgrades = { ...r.upgrades };
      this.quests = r.quests.map((q) => ({ ...q }));
      this.mpChat = [...r.chat];

      this.rebuildWorldForDay(this.day, this.quests);
      this.resetWorldEntities();
      this.resetPlayerToBurrow();
      this.hp = this.maxHp;
      this.stamina = 100;
      this.isDowned = false;
      this.respawnTimer = 0;
      this.applyUpgradesVisuals();

      this.mpPlayers.clear();
      for (const p of r.players) {
        this.mpPlayers.set(p.id, p);
        if (p.id === ev.myId) {
          this.playerPos.set(p.x, p.y, p.z);
        } else {
          this.ensureRemoteAvatar(p);
        }
      }

      for (const np of r.props) {
        this.applyPropStateFromNet(np);
      }
      for (const ni of r.insects) {
        const ins = this.world.insects.find((item) => item.id === ni.id);
        if (ins) {
          ins.position.set(ni.x, ni.y, ni.z);
          ins.mesh.position.set(ni.x, ni.y, ni.z);
          ins.yaw = ni.yaw;
          ins.hp = ni.hp;
          ins.dead = ni.dead;
          if (ni.dead) ins.mesh.visible = false;
        }
      }

      this.humanPos.set(r.human.x, r.human.y, r.human.z);
      this.humanTargetPos.copy(this.humanPos);
      this.humanYaw = r.human.yaw;
      this.humanTargetYaw = r.human.yaw;
      this.humanHp = r.human.hp;
      this.humanMaxHp = r.human.maxHp;
      this.humanDead = r.human.dead;
      this.humanDeathFall = r.human.dead ? 1 : 0;
      this.humanAlert = r.human.alert;
      this.setHumanWeapon(r.human.weapon, true);

      if (r.car) {
        this.carPos.set(r.car.x, r.car.y, r.car.z);
        this.carTargetPos.copy(this.carPos);
        this.carYaw = r.car.yaw;
        this.carTargetYaw = r.car.yaw;
        this.carSpeed = r.car.speed;
        this.carSteer = r.car.steer;
        this.carDriverId = r.car.driverId;
        this.carPassengerId = r.car.passengerId;
        this.inCarSeat = r.car.driverId === ev.myId ? 1 : r.car.passengerId === ev.myId ? 2 : 0;
      }

      if (r.bossGnome?.active) {
        this.activateGiantBossGnome(r.bossGnome.x, r.bossGnome.y, r.bossGnome.z);
      }

      if (r.pets) {
        this.dogPos.set(r.pets.dog.x, r.pets.dog.y, r.pets.dog.z);
        this.dogTargetPos.copy(this.dogPos);
        this.dogYaw = r.pets.dog.yaw;
        this.dogTargetYaw = r.pets.dog.yaw;
        this.dogAlert = r.pets.dog.alert;
        this.catPos.set(r.pets.cat.x, r.pets.cat.y, r.pets.cat.z);
        this.catTargetPos.copy(this.catPos);
        this.catYaw = r.pets.cat.yaw;
        this.catTargetYaw = r.pets.cat.yaw;
        this.catAlert = r.pets.cat.alert;
      }

      if (this.pendingJoinResolve) {
        const res = this.pendingJoinResolve;
        this.pendingJoinResolve = null;
        this.pendingJoinReject = null;
        res();
      }

      this.setScreen(this.summaryReason ? 'summary' : 'playing');
      this.showNotification(`Сервер ${r.code} · ${this.world.house.name}`);
      return;
    }

    if (!this.mpActive) return;

    if (ev.type === 'player:joined') {
      this.mpPlayers.set(ev.player.id, ev.player);
      this.ensureRemoteAvatar(ev.player);
      this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      this.sound.playCraft();
      this.showNotification(`${ev.player.name} зашёл на сервер!`);
      this.emitHud();
      return;
    }

    if (ev.type === 'player:left') {
      const leaving = this.mpPlayers.get(ev.playerId);
      this.mpPlayers.delete(ev.playerId);
      this.removeRemoteAvatar(ev.playerId);
      if (this.humanGrabTargetId === ev.playerId) {
        this.humanGrabState = 'none';
        this.humanGrabTargetId = null;
        this.humanCarryPath = [];
        this.humanCarryIdx = 0;
      }
      const wasHost = this.mpIsHost;
      this.mpIsHost = ev.newHostId === this.mpMyId;
      for (const [id, p] of this.mpPlayers) {
        p.isHost = id === ev.newHostId;
      }
      this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      if (!wasHost && this.mpIsHost) {
        this.showNotification('Ты стал новым хостом сервера!');
      } else if (leaving) {
        this.showNotification(`${leaving.name} вышел с сервера`);
      }
      this.emitHud();
      return;
    }

    if (ev.type === 'player:moved') {
      this.mpPlayers.set(ev.player.id, ev.player);
      return;
    }

    if (ev.type === 'day:state') {
      this.dayStarted = ev.dayStarted;
      this.timeRemaining = ev.timeRemaining;
      if (ev.chatMessage) {
        this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      }
      this.emitHud();
      return;
    }

    if (ev.type === 'day:tick') {
      this.timeRemaining = ev.timeRemaining;
      this.emitHud();
      return;
    }

    if (ev.type === 'day:finished') {
      this.finishDay(ev.reason);
      return;
    }

    if (ev.type === 'hub:deployed') {
      this.inTreeHub = false;
      this.dayStarted = true;
      this.playerPos.copy(this.world.houseArrivalPos);
      this.playerVel.set(0, 0, 0);
      this.yaw = 0;
      this.pitch = 0;
      this.sound.playPlayButton();
      this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      this.showNotification(`${ev.triggeredBy} нажал PLAY! Вы у дома: ${this.world.house.name}!`);
      this.emitHud();
      return;
    }

    if (ev.type === 'day:reset') {
      this.day = ev.day;
      this.dayStarted = false;
      this.inTreeHub = ev.inTreeHub ?? true;
      this.timeRemaining = ev.timeRemaining;
      this.hp = this.maxHp;
      this.stamina = 100;
      this.isDowned = false;
      this.respawnTimer = 0;
      this.summaryReason = null;
      this.quests = ev.quests.map((q) => ({ ...q }));
      this.rebuildWorldForDay(this.day, this.quests);
      this.resetWorldEntities();
      this.resetPlayerToBurrow();
      if (ev.props) {
        for (const np of ev.props) {
          this.applyPropStateFromNet(np);
        }
      }
      if (ev.insects) {
        for (const ni of ev.insects) {
          const ins = this.world.insects.find((item) => item.id === ni.id);
          if (ins) {
            ins.position.set(ni.x, ni.y, ni.z);
            ins.mesh.position.set(ni.x, ni.y, ni.z);
            ins.yaw = ni.yaw;
            ins.hp = ni.hp;
            ins.dead = ni.dead;
            if (ni.dead) ins.mesh.visible = false;
          }
        }
      }
      if (ev.human) {
        this.humanPos.set(ev.human.x, ev.human.y, ev.human.z);
        this.humanTargetPos.copy(this.humanPos);
        this.humanYaw = ev.human.yaw;
        this.humanTargetYaw = ev.human.yaw;
        this.humanHp = ev.human.hp;
        this.humanMaxHp = ev.human.maxHp;
        this.humanDead = ev.human.dead;
      }
      if (ev.car) {
        this.carPos.set(ev.car.x, ev.car.y, ev.car.z);
        this.carTargetPos.copy(this.carPos);
        this.carYaw = ev.car.yaw;
        this.carTargetYaw = ev.car.yaw;
        this.carDriverId = ev.car.driverId;
        this.carPassengerId = ev.car.passengerId;
      }
      this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      this.setScreen('playing');
      this.showNotification(`День ${ev.day} · Зайди в Дерево с глазами и нажми PLAY!`);
      return;
    }

    if (ev.type === 'prop:grab_denied') {
      if (this.heldProp && this.heldProp.id === ev.propId) {
        this.heldProp.isHeld = false;
        this.heldProp = null;
        this.showNotification('Этот предмет уже держит другой гном!');
        this.emitHud();
      }
      return;
    }

    if (ev.type === 'prop:state') {
      this.applyPropStateFromNet(ev.prop, false);
      return;
    }

    if (ev.type === 'prop:moved') {
      this.applyPropStateFromNet(ev.prop, true);
      return;
    }

    if (ev.type === 'prop:collected') {
      const p = this.world.props.find((pr) => pr.id === ev.propId);
      if (p) {
        p.collected = true;
        p.isHeld = false;
        p.mesh.visible = false;
        if (this.heldProp === p) this.heldProp = null;
      }
      this.shinies = ev.shinies;
      this.scrap = ev.scrap;
      this.quests = ev.quests.map((q) => ({ ...q }));
      this.sound.playCraft();
      this.spawnBurst(this.world.stashCenter.clone().setY(0.8), 8, this.sparkMat);
      if (ev.completedTitles.length > 0) {
        this.sound.playQuestComplete();
        this.showNotification(`Задание выполнено: ${ev.completedTitles[0]}`);
      } else {
        this.showNotification(`${ev.collectorName} сдал: ${ev.propName} (+${ev.valueShinies})`);
      }
      this.emitHud();
      return;
    }

    if (ev.type === 'prop:broken') {
      const p = this.world.props.find((pr) => pr.id === ev.propId);
      if (p) {
        p.broken = true;
        p.isHeld = false;
        p.mesh.visible = false;
        if (p.questMarker) p.questMarker.visible = false;
        if (this.heldProp === p) this.heldProp = null;
      }
      this.shinies = ev.shinies;
      this.scrap = ev.scrap;
      this.quests = ev.quests.map((q) => ({ ...q }));
      this.sound.playShatter();
      this.spawnBurst(_v1.set(ev.x, ev.y, ev.z), 12, this.shardMat);
      if (ev.completedTitles.length > 0) {
        this.sound.playQuestComplete();
        this.showNotification(`Задание выполнено: ${ev.completedTitles[0]}`);
      }
      this.emitHud();
      return;
    }

    if (ev.type === 'prop:tipped') {
      const p = this.world.props.find((pr) => pr.id === ev.propId);
      if (p) {
        p.tipped = true;
        p.mesh.rotation.z = Math.PI / 2;
      }
      this.shinies = ev.shinies;
      this.scrap = ev.scrap;
      this.quests = ev.quests.map((q) => ({ ...q }));
      this.sound.playTrashCrash();
      this.spawnBurst(_v1.set(ev.x, ev.y, ev.z), 10, this.dustMat, true);
      if (ev.completedTitles.length > 0) {
        this.sound.playQuestComplete();
        this.showNotification(`Задание выполнено: ${ev.completedTitles[0]}`);
      }
      this.emitHud();
      return;
    }

    if (ev.type === 'insect:hit') {
      const ins = this.world.insects.find((item) => item.id === ev.insectId);
      if (ins) {
        ins.hp = ev.hp;
        ins.hitFlash = 0.22;
        ins.velocity.set(ev.vx, ev.vy, ev.vz);
        this.spawnBurst(ins.mesh.position, 6, this.sparkMat);
        if (ev.dead && !ins.dead) {
          ins.dead = true;
          ins.deathTimer = 1.2;
          this.showNotification(`${ev.killerName} одолел насекомое! +6 Блестяшек`);
        }
      }
      this.shinies = ev.shinies;
      this.scrap = ev.scrap;
      this.emitHud();
      return;
    }

    if (ev.type === 'craft:updated') {
      this.upgrades = { ...ev.upgrades };
      this.shinies = ev.shinies;
      this.scrap = ev.scrap;
      if (this.upgrades.drone) {
        this.droneBattery = 100;
        if (this.world.droneDockMesh) this.world.droneDockMesh.visible = false;
      }
      this.applyUpgradesVisuals();
      this.sound.playCraft();
      this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      this.showNotification(ev.chatMessage.text);
      this.emitHud();
      return;
    }

    if (ev.type === 'car:state') {
      const c = ev.car;
      this.carDriverId = c.driverId;
      this.carPassengerId = c.passengerId;
      const newSeat: 0 | 1 | 2 = c.driverId === this.mpMyId ? 1 : c.passengerId === this.mpMyId ? 2 : 0;
      if (this.inCarSeat === 0 && newSeat > 0) {
        this.yaw = c.yaw;
        this.sound.playCarHorn();
        this.showNotification(
          newSeat === 1
            ? 'Машинка на двоих! WASD езда · Shift турбо · ЛКМ гудок · E выйти'
            : 'Ты пассажир машинки! Наслаждайся поездкой · E выйти'
        );
      }
      this.inCarSeat = newSeat;
      if (this.inCarSeat !== 1) {
        this.carTargetPos.set(c.x, c.y, c.z);
        this.carTargetYaw = c.yaw;
        this.carSpeed = c.speed;
        this.carSteer = c.steer;
      }
      this.emitHud();
      return;
    }

    if (ev.type === 'human:damaged') {
      this.humanHp = ev.hp;
      this.humanMaxHp = ev.maxHp;
      this.humanDead = ev.dead;
      if (ev.dead) {
        this.humanGrabState = 'none';
        this.humanGrabTargetId = null;
        this.humanRemoteAiming = false;
        this.human.muzzleFlash.visible = false;
        this.human.alertBadge.visible = false;
        this.sound.playHumanDefeat();
        this.spawnBurst(this.humanPos.clone().setY(5.0), 18, this.sparkMat);
      } else {
        this.humanStartleTimer = 0.45;
      }
      if (ev.chatMessage) {
        this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      }
      this.showNotification(
        ev.dead ? 'СОСЕД ПОВЕРЖЕН! За вами идёт БОЛЬШОЙ ГНОМ!' : `Сосед ранен! (${ev.hp}/${ev.maxHp} HP)`
      );
      this.emitHud();
      return;
    }

    if (ev.type === 'boss:spawned') {
      this.mpChat = [...this.mpChat.slice(-29), ev.chatMessage];
      this.activateGiantBossGnome(ev.bossGnome.x, ev.bossGnome.y, ev.bossGnome.z);
      return;
    }

    if (ev.type === 'world:sync') {
      if (this.mpIsHost) return;
      const h = ev.human;
      this.humanTargetPos.set(h.x, h.y, h.z);
      this.humanTargetYaw = h.yaw;
      this.humanHp = h.hp;
      this.humanMaxHp = h.maxHp;
      this.humanDead = h.dead;
      if (this.humanAlert !== h.alert && h.alert === 'chase' && !h.dead) {
        this.sound.playHumanAlert();
      }
      this.humanAlert = h.alert;
      this.setHumanWeapon(h.weapon, h.weapon === 'broom');
      if (h.grabState === 'carrying' && this.humanGrabState === 'none') {
        this.sound.playHumanGrab();
        if (h.grabTargetId === this.mpMyId) {
          this.showNotification('Сосед схватил тебя и тащит к выходу!');
        }
      }
      this.humanGrabState = h.grabState;
      this.humanGrabTargetId = h.grabTargetId;
      this.humanRemoteAiming = h.aiming;
      this.humanStartleTimer = h.startleTimer;
      this.humanSwipeTimer = h.swipeTimer;

      if (ev.car && this.inCarSeat !== 1) {
        this.carDriverId = ev.car.driverId;
        this.carPassengerId = ev.car.passengerId;
        this.carTargetPos.set(ev.car.x, ev.car.y, ev.car.z);
        this.carTargetYaw = ev.car.yaw;
        this.carSpeed = ev.car.speed;
        this.carSteer = ev.car.steer;
      }

      if (ev.bossGnome) {
        if (ev.bossGnome.active && !this.bossActive) {
          this.activateGiantBossGnome(ev.bossGnome.x, ev.bossGnome.y, ev.bossGnome.z);
        }
        this.bossActive = ev.bossGnome.active;
        this.bossTargetPos.set(ev.bossGnome.x, ev.bossGnome.y, ev.bossGnome.z);
        this.bossTargetYaw = ev.bossGnome.yaw;
        this.bossSwipeTimer = ev.bossGnome.swipeTimer;
      }

      if (ev.pets) {
        this.dogTargetPos.set(ev.pets.dog.x, ev.pets.dog.y, ev.pets.dog.z);
        this.dogTargetYaw = ev.pets.dog.yaw;
        this.dogAlert = ev.pets.dog.alert;
        this.catTargetPos.set(ev.pets.cat.x, ev.pets.cat.y, ev.pets.cat.z);
        this.catTargetYaw = ev.pets.cat.yaw;
        this.catAlert = ev.pets.cat.alert;
      }

      for (const np of ev.props) {
        this.applyPropStateFromNet(np, false);
      }
      for (const ni of ev.insects) {
        const ins = this.world.insects.find((item) => item.id === ni.id);
        if (ins && !ins.dead) {
          ins.position.set(ni.x, ni.y, ni.z);
          ins.yaw = ni.yaw;
        }
      }
      return;
    }

    if (ev.type === 'human:shoot') {
      if (this.mpIsHost) return;
      this.sound.playGunshot(ev.weapon);
      this.humanMuzzleTimer = 0.085;
      this.humanRecoilTimer = 0.24;
      this.human.muzzleFlash.visible = true;
      for (const b of ev.bullets) {
        const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
        m.position.set(ev.origin.x, ev.origin.y, ev.origin.z);
        this.scene.add(m);
        this.bullets.push({
          mesh: m,
          vel: new THREE.Vector3(b.vx, b.vy, b.vz),
          life: 1.8,
          damage: b.damage,
        });
      }
      return;
    }

    if (ev.type === 'human:thrown') {
      this.humanGrabState = 'none';
      this.humanGrabTargetId = null;
      this.grabStruggle = 0;
      this.playerPos.set(ev.x, ev.y, ev.z);
      this.playerVel.set(ev.vx, ev.vy, ev.vz);
      this.isGrounded = false;
      this.wasGrounded = false;
      this.sound.playThrow();
      this.damagePlayer(ev.damage, 'Сосед вынес тебя на крыльцо и швырнул во двор!');
      return;
    }

    if (ev.type === 'human:escaped') {
      if (this.mpIsHost && this.humanGrabTargetId === ev.playerId) {
        this.releaseGrabbedPlayerByEscape(ev.playerId);
      }
      return;
    }

    if (ev.type === 'chat:message') {
      this.mpChat = [...this.mpChat.slice(-29), ev.message];
      this.emitHud();
    }
  }

  private buildPromptText(): string | null {
    if (this.isDowned) {
      return `Возрождение через ${Math.ceil(this.respawnTimer)} сек...`;
    }
    if (this.inCarSeat === 1) {
      return `Машинка (Водитель) · [ЛКМ] Гудок · [Shift] Турбо · [E] Выйти`;
    }
    if (this.inCarSeat === 2) {
      return `Машинка (Пассажир) · [E] Выйти`;
    }
    if (this.inTreeHub) {
      if (this.nearPlayButton) {
        return '[E] Нажать PLAY — отправиться к дому соседа!';
      }
      if (this.playerPos.z > 134) {
        return 'Зайди в домик внутри Дерева с глазами к зелёному кристаллу PLAY';
      }
      return null;
    }
    if (this.inMiniCopter) {
      const cargoTxt = this.copterCargo ? `Груз: ${this.copterCargo.name} · [ЛКМ/ПКМ] Сбросить` : '[ЛКМ] Магнитный крюк';
      return `Миникоптер · ${cargoTxt} · [E] Выйти`;
    }
    if (this.inDroneMode) {
      const cargoTxt = this.droneCargo ? `Груз: ${this.droneCargo.name} · [ЛКМ] Сбросить` : '[ЛКМ] Захват груза';
      return `Мавик-Дрон · ${cargoTxt} · [ПКМ] Электрошокер · [F] Вернуть`;
    }
    if (this.playerPos.distanceTo(this.carPos) < 4.5 && (!this.carDriverId || !this.carPassengerId)) {
      const seatsLeft = (this.carDriverId ? 0 : 1) + (this.carPassengerId ? 0 : 1);
      return `[E] Сесть в машинку на двоих (свободно мест: ${seatsLeft}/2)`;
    }
    if (this.playerPos.distanceTo(this.copterPos) < 4.2) {
      return '[E] Сесть за штурвал Миникоптера гномов';
    }
    if (
      !this.upgrades.drone &&
      !this.garageDronePicked &&
      this.playerPos.distanceTo(this.world.droneDockPos) < 3.8
    ) {
      return '[E] Взять Мавик-Дрон с зарядной станции';
    }
    if (this.playerPos.distanceTo(this.world.workbenchPos) < 3.6) {
      return '[E] Открыть Верстак (крафт снаряжения и дрона)';
    }
    if (this.playerPos.distanceTo(this.world.highGnomePos) < 3.6) {
      const done = this.quests.filter((q) => q.completed).length;
      if (done >= 3) {
        return this.mpActive && !this.mpIsHost
          ? '[E] Прогресс заданий (завершает хост)'
          : '[E] Завершить день у Верховного Гнома';
      }
      return '[E] Поговорить с Верховным Гномом (задания)';
    }
    if (this.activeClimb) {
      return `[W / Space] Карабкаться: ${this.activeClimb.label}`;
    }
    if (this.heldProp) {
      return `${this.heldProp.name} · [ЛКМ] Отпустить · [ПКМ] Бросить · [Колёсико] Дистанция`;
    }
    const target = this.getTargetedProp();
    if (target) {
      return `[ЛКМ] Взять: ${target.name}`;
    }
    return null;
  }

  private emitHud(): void {
    const inBurrow = !this.inTreeHub && this.isPointInBurrow(this.playerPos.x, this.playerPos.z);
    const isOutside = !this.inTreeHub && this.playerPos.z > 42.5;
    const hideZone = this.getCurrentHideZone();

    const playersList = this.mpActive
      ? Array.from(this.mpPlayers.values()).sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1))
      : [];

    this.onHudUpdate({
      day: this.day,
      house: this.world.house.summary,
      timeRemaining: Math.ceil(this.timeRemaining),
      dayDuration: DAY_DURATION,
      dayStarted: this.dayStarted,
      hp: Math.ceil(this.hp),
      maxHp: this.maxHp,
      stamina: Math.ceil(this.stamina),
      shinies: this.shinies,
      scrap: this.scrap,
      upgrades: { ...this.upgrades },
      quests: this.quests.map((q) => ({ ...q })),
      completedQuestsCount: this.quests.filter((q) => q.completed).length,
      minQuestsRequired: 3,
      humanAlert: this.humanAlert,
      humanWeapon: this.humanWeapon,
      humanDistance: Math.round(this.playerPos.distanceTo(this.humanPos)),
      isHidden: inBurrow || (hideZone !== null && this.isCrouching),
      isCrouching: this.isCrouching,
      isClimbing: this.isClimbing,
      inBurrow,
      isOutside,
      isGrabbedByHuman: this.humanGrabState !== 'none' && this.humanGrabTargetId === this.getLocalPlayerId(),
      grabStruggle: this.grabStruggle,
      isDowned: this.isDowned,
      respawnTimer: Math.ceil(this.respawnTimer),
      inMiniCopter: this.inMiniCopter,
      copterAltitude: Math.round(this.copterPos.y * 10) / 10,
      copterSpeed: Math.round(Math.hypot(this.copterVel.x, this.copterVel.z)),
      hasDrone: this.upgrades.drone || this.garageDronePicked,
      inDroneMode: this.inDroneMode,
      droneBattery: Math.round(this.droneBattery),
      dismemberMask: this.dismemberMask,
      inTreeHub: this.inTreeHub,
      nearPlayButton: this.nearPlayButton,
      inCarSeat: this.inCarSeat,
      carSpeed: Math.round(Math.abs(this.carSpeed)),
      carSeatsUsed: (this.carDriverId ? 1 : 0) + (this.carPassengerId ? 1 : 0),
      humanHp: this.humanHp,
      humanMaxHp: this.humanMaxHp,
      humanDead: this.humanDead,
      giantGnomeActive: this.bossActive,
      giantGnomeDistance: this.bossActive ? Math.round(this.playerPos.distanceTo(this.bossPos)) : 0,
      dogAlert: this.dogAlert,
      catAlert: this.catAlert,
      heldItemName: this.heldProp
        ? this.heldProp.name
        : this.copterCargo
          ? this.copterCargo.name
          : this.droneCargo
            ? this.droneCargo.name
            : null,
      heldItemWeight: this.heldProp ? this.heldProp.weight : 0,
      holdDistance: this.holdDistance,
      promptText: this.buildPromptText(),
      pointerLocked: this.pointerLocked,
      muted: this.sound.isMuted(),
      summaryReason: this.summaryReason,
      notification: this.notification,
      multiplayer: this.mpActive
        ? {
            active: true,
            roomCode: this.mpRoomCode,
            roomName: this.mpRoomName,
            isPublic: this.mpIsPublic,
            isHost: this.mpIsHost,
            myId: this.mpMyId,
            connectionStatus: this.mpConnectionStatus,
            players: playersList,
            chat: this.mpChat,
          }
        : null,
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.mpClient.disconnect();
    this.clearRemoteAvatars();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupFns.forEach((fn) => fn());

    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });

    this.textures.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

export { GNOME_COLOR_PALETTE };
