import * as THREE from 'three';
import {
  AABBCollider,
  ClimbableZone,
  HideZone,
  InsectEntity,
  InteractiveProp,
  ItemCategory,
  Quest,
} from '../types/game';
import { createSeededRng, getHouseBlueprint, HouseBlueprint } from './houses';
import {
  createChairModel,
  createHighGnomeModel,
  createInsectModel,
  createMavicDroneModel,
  createPropModel,
  createTreeWithEyesModel,
  createWorkbenchModel,
  GnomeNpcRig,
  TreeWithEyesRig,
} from './models';
import {
  addCartoonOutline,
  applyStylizedShaderToObject,
  createSunbeamMaterial,
} from './stylizedShader';
import { TextureLibrary } from './textures';

export interface NavNode {
  id: string;
  pos: THREE.Vector3;
}

export interface BuiltWorld {
  worldGroup: THREE.Group;
  house: HouseBlueprint;
  colliders: AABBCollider[];
  climbables: ClimbableZone[];
  hideZones: HideZone[];
  props: InteractiveProp[];
  insects: InsectEntity[];
  patrolWaypoints: THREE.Vector3[];
  navNodes: NavNode[];
  navEdges: Record<string, string[]>;
  highGnomePos: THREE.Vector3;
  highGnomeRig: GnomeNpcRig;
  companionRigs: Array<{ rig: GnomeNpcRig; basePos: THREE.Vector3; baseYaw: number }>;
  workbenchPos: THREE.Vector3;
  stashCenter: THREE.Vector3;
  stashRadius: number;
  burrowBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  garageCopterPos: THREE.Vector3;
  droneDockPos: THREE.Vector3;
  droneDockMesh: THREE.Group;
  garageBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  bathroomBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  shedBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  carSpawnPos: THREE.Vector3;
  dogSpawnPos: THREE.Vector3;
  catSpawnPos: THREE.Vector3;
  doghousePos: THREE.Vector3;
  hubSpawnPos: THREE.Vector3;
  houseArrivalPos: THREE.Vector3;
  playButtonPos: THREE.Vector3;
  hubInteriorBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  treeWithEyesRig: TreeWithEyesRig;
  spawnPos: THREE.Vector3;
  frontDoorPos: THREE.Vector3;
  porchTargetPos: THREE.Vector3;
  streetDropPos: THREE.Vector3;
  titleCameraCenter: THREE.Vector3;
  isKitchenAt: (x: number, z: number) => boolean;
  chandelierGlow: THREE.Mesh;
  burrowLight: THREE.PointLight;
  burrowFlame: THREE.Mesh;
  cauldronBubbles: THREE.Mesh[];
  tvScreenMat: THREE.MeshStandardMaterial;
  animatedUniforms: Array<{ uTime: { value: number } }>;
}

interface PropCategoryMeta {
  names: string[];
  valueShinies: number;
  valueScrap: number;
  breakable?: boolean;
  isTrashBin?: boolean;
}

const PROP_META: Record<ItemCategory, PropCategoryMeta> = {
  cheese: {
    names: ['Кусок сыра', 'Сыр чеддер', 'Сырный ломоть'],
    valueShinies: 18,
    valueScrap: 0,
  },
  battery: {
    names: ['Батарейка AA', 'Зарядная батарейка', 'Элемент питания'],
    valueShinies: 16,
    valueScrap: 2,
  },
  fork: {
    names: ['Стальная вилка', 'Десертная вилка', 'Острая вилка'],
    valueShinies: 14,
    valueScrap: 2,
  },
  spoon: {
    names: ['Столовая ложка', 'Серебряная ложка', 'Чайная ложка'],
    valueShinies: 14,
    valueScrap: 2,
  },
  coin: {
    names: ['Золотая монета', 'Старинный дублон', 'Блестящий червонец'],
    valueShinies: 22,
    valueScrap: 0,
  },
  matchbox: {
    names: ['Коробок спичек', 'Сухие спички', 'Огненный коробок'],
    valueShinies: 15,
    valueScrap: 1,
  },
  mug: {
    names: ['Керамическая кружка', 'Утренняя кружка', 'Кружка с кофе'],
    valueShinies: 12,
    valueScrap: 1,
    breakable: true,
  },
  scrap: {
    names: ['Латунная шестерня', 'Болт и пружина', 'Медная катушка'],
    valueShinies: 10,
    valueScrap: 3,
  },
  trashbin: {
    names: ['Мусорное ведро', 'Кухонный бак'],
    valueShinies: 25,
    valueScrap: 2,
    isTrashBin: true,
  },
  key: {
    names: ['Золотой ключ', 'Латунная отмычка', 'Старый ключ'],
    valueShinies: 26,
    valueScrap: 1,
  },
  ring: {
    names: ['Рубиновое кольцо', 'Перстень хозяина', 'Золотой перстень'],
    valueShinies: 32,
    valueScrap: 0,
  },
  watch: {
    names: ['Карманные часы', 'Золотой хронометр', 'Тикающие часы'],
    valueShinies: 28,
    valueScrap: 2,
  },
  apple: {
    names: ['Спелое яблоко', 'Садовое яблоко', 'Красное яблоко'],
    valueShinies: 16,
    valueScrap: 0,
  },
  candle: {
    names: ['Восковая свеча', 'Латунный подсвечник', 'Ароматная свеча'],
    valueShinies: 22,
    valueScrap: 1,
  },
  vase: {
    names: ['Фарфоровая ваза', 'Расписная ваза', 'Антикварная ваза'],
    valueShinies: 24,
    valueScrap: 1,
    breakable: true,
  },
  plate: {
    names: ['Расписная тарелка', 'Фарфоровое блюдо', 'Парадная тарелка'],
    valueShinies: 18,
    valueScrap: 1,
    breakable: true,
  },
  remote: {
    names: ['Пульт от ТВ', 'Универсальный пульт', 'Пульт хозяина'],
    valueShinies: 22,
    valueScrap: 2,
  },
};

const ALL_LOOT_CATEGORIES: ItemCategory[] = [
  'cheese',
  'battery',
  'fork',
  'spoon',
  'coin',
  'matchbox',
  'mug',
  'scrap',
  'key',
  'ring',
  'watch',
  'apple',
  'candle',
  'vase',
  'plate',
  'remote',
];

export function buildHouseWorld(
  scene: THREE.Scene,
  textures: TextureLibrary,
  house: HouseBlueprint = getHouseBlueprint(1),
  activeQuests: Quest[] = []
): BuiltWorld {
  const worldGroup = new THREE.Group();
  worldGroup.name = `house-world-${house.id}`;
  scene.add(worldGroup);

  const rng = createSeededRng(house.seed + 4242);
  const colliders: AABBCollider[] = [];
  const climbables: ClimbableZone[] = [];
  const hideZones: HideZone[] = [];
  const props: InteractiveProp[] = [];
  const insects: InsectEntity[] = [];
  const propAnchors: Array<{ x: number; yBottom: number; z: number; elevated: boolean }> = [];

  // Mirror X cleanly around the house centerline X = 28 ([-36.5 .. 92.5])
  const mx = (x: number): number => (house.mirrorX ? 56 - x : x);
  const mrot = (r: number): number => (house.mirrorX ? -r : r);

  const addBoxCollider = (
    id: string,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    isFloorLike = false
  ) => {
    const x1 = mx(minX);
    const x2 = mx(maxX);
    colliders.push({
      id,
      minX: Math.min(x1, x2),
      maxX: Math.max(x1, x2),
      minY,
      maxY,
      minZ,
      maxZ,
      isFloorLike,
    });
  };

  const addHideZone = (
    id: string,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    label: string
  ) => {
    const x1 = mx(minX);
    const x2 = mx(maxX);
    hideZones.push({
      id,
      minX: Math.min(x1, x2),
      maxX: Math.max(x1, x2),
      minY,
      maxY,
      minZ,
      maxZ,
      label,
    });
  };

  const addClimbable = (
    id: string,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    nx: number,
    ny: number,
    nz: number,
    label: string
  ) => {
    const x1 = mx(minX);
    const x2 = mx(maxX);
    climbables.push({
      id,
      minX: Math.min(x1, x2),
      maxX: Math.max(x1, x2),
      minY,
      maxY,
      minZ,
      maxZ,
      normal: new THREE.Vector3(house.mirrorX ? -nx : nx, ny, nz),
      label,
    });
  };

  const addStaticBox = (
    id: string,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    castShadow = true,
    receiveShadow = true,
    collide = true
  ): THREE.Mesh => {
    const worldX = mx(cx);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(worldX, cy, cz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    worldGroup.add(mesh);
    if (collide) {
      colliders.push({
        id,
        minX: worldX - sx / 2,
        maxX: worldX + sx / 2,
        minY: cy - sy / 2,
        maxY: cy + sy / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
      });
    }
    return mesh;
  };

  const pal = house.palette;
  const mood = house.mood;

  // Per-house stylized PBR material palette
  const wallMat = new THREE.MeshStandardMaterial({ color: pal.wallKitchen, roughness: 0.9 });
  const livingWallMat = new THREE.MeshStandardMaterial({
    color: pal.wallLivingTint,
    map: textures.wallpaperStripes,
    roughness: 0.9,
  });
  const bedroomWallMat = new THREE.MeshStandardMaterial({ color: pal.wallBedroom, roughness: 0.9 });
  const baseboardMat = new THREE.MeshStandardMaterial({ color: pal.baseboard, roughness: 0.7 });
  const woodDarkMat = new THREE.MeshStandardMaterial({ color: pal.woodDark, roughness: 0.8 });
  const woodMedMat = new THREE.MeshStandardMaterial({ color: pal.woodMed, roughness: 0.76 });
  const cabinetMat = new THREE.MeshStandardMaterial({ color: pal.cabinet, roughness: 0.72 });
  const marbleMat = new THREE.MeshStandardMaterial({ map: textures.marbleCounter, roughness: 0.35, metalness: 0.05 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xaab2ba, roughness: 0.28, metalness: 0.86 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.42, metalness: 0.78 });
  const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xc4cbcf, roughness: 0.32, metalness: 0.45 });
  const sofaMat = new THREE.MeshStandardMaterial({ color: pal.sofa, roughness: 0.9 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: pal.cushion, roughness: 0.92 });
  const curtainMat = new THREE.MeshStandardMaterial({
    color: pal.curtainTint,
    map: textures.curtainFabric,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const vineMat = new THREE.MeshStandardMaterial({ color: 0x3f7337, roughness: 0.82 });
  const fenceMat = new THREE.MeshStandardMaterial({ color: pal.fence, roughness: 0.84 });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4eefc,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.95,
    ior: 1.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // ==================== FLOORS & CEILING ====================
  const kitchenFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 58),
    new THREE.MeshStandardMaterial({
      map: textures.kitchenTile,
      normalMap: textures.kitchenTileNormal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: textures.kitchenTileRoughness,
      roughness: 0.88,
      metalness: 0.06,
    })
  );
  kitchenFloor.rotation.x = -Math.PI / 2;
  kitchenFloor.position.set(mx(-11), 0, -3);
  kitchenFloor.receiveShadow = true;
  worldGroup.add(kitchenFloor);

  const oakFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(132, 102),
    new THREE.MeshStandardMaterial({
      map: textures.oakWood,
      normalMap: textures.oakWoodNormal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughnessMap: textures.oakWoodRoughness,
      roughness: 0.9,
      metalness: 0.04,
    })
  );
  oakFloor.rotation.x = -Math.PI / 2;
  oakFloor.position.set(28, -0.02, -7);
  oakFloor.receiveShadow = true;
  worldGroup.add(oakFloor);

  // Outdoor Grass Lawn & Cobblestone Path (expanded symmetrically for Garage wing)
  const grassFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 44),
    new THREE.MeshStandardMaterial({
      color: mood.id === 'winter' ? 0xd9e8ed : mood.id === 'autumn' ? 0xd6c28f : 0xffffff,
      map: textures.grassLawn,
      roughness: 0.95,
    })
  );
  grassFloor.rotation.x = -Math.PI / 2;
  grassFloor.position.set(mx(44), -0.03, 64);
  grassFloor.receiveShadow = true;
  worldGroup.add(grassFloor);

  const cobbleWalk = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 28),
    new THREE.MeshStandardMaterial({
      map: textures.cobblePath,
      normalMap: textures.cobblePathNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.86,
    })
  );
  cobbleWalk.rotation.x = -Math.PI / 2;
  cobbleWalk.position.set(mx(53), 0.01, 57);
  cobbleWalk.receiveShadow = true;
  worldGroup.add(cobbleWalk);

  addBoxCollider('main-floor', -52, 134, -2, 0, -60, 86, true);

  // Living room & bedroom woven rugs
  const rugMat = new THREE.MeshStandardMaterial({
    color: pal.rugTint,
    map: textures.rugPattern,
    roughness: 0.94,
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(24, 28), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(mx(36), 0.03, -4);
  rug.receiveShadow = true;
  worldGroup.add(rug);

  const bedRug = new THREE.Mesh(new THREE.PlaneGeometry(18, 22), rugMat);
  bedRug.rotation.x = -Math.PI / 2;
  bedRug.position.set(mx(74), 0.03, -2);
  bedRug.receiveShadow = true;
  worldGroup.add(bedRug);

  // Indoor ceiling (leaves outdoor yard z > 43 open to sky)
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(132, 102),
    new THREE.MeshStandardMaterial({ color: 0xcfc7b8, roughness: 0.94 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(28, 26, -7);
  worldGroup.add(ceiling);

  // ==================== OUTER HOUSE WALLS & GLASS WINDOWS ====================
  addStaticBox('wall-north-k', -11, 13, -32.5, 51, 26, 1, wallMat, false, true);
  addStaticBox('wall-west-study', 14, 13, -44.5, 1, 26, 25, livingWallMat, true, true);
  addStaticBox('wall-north-study-w', 20, 13, -56.5, 12, 26, 1, livingWallMat, false, true);
  addStaticBox('wall-north-study-e', 52, 13, -56.5, 12, 26, 1, livingWallMat, false, true);
  addStaticBox('wall-north-study-low', 36, 3.5, -56.5, 20, 7, 1, livingWallMat, false, true);
  addStaticBox('wall-north-study-top', 36, 23, -56.5, 20, 6, 1, livingWallMat, false, true);
  // North Bedroom wall split around glass window (X: 69..83)
  addStaticBox('wall-north-bed-w', 63, 13, -56.5, 12, 26, 1, bedroomWallMat, false, true);
  addStaticBox('wall-north-bed-e', 88, 13, -56.5, 10, 26, 1, bedroomWallMat, false, true);
  addStaticBox('wall-north-bed-low', 76, 3.5, -56.5, 14, 7, 1, bedroomWallMat, false, true);
  addStaticBox('wall-north-bed-top', 76, 23, -56.5, 14, 6, 1, bedroomWallMat, false, true);
  addStaticBox('window-bed-sill', 76, 7.1, -55.5, 14, 0.4, 2.0, woodMedMat, true, true);
  const bedNorthGlass = new THREE.Mesh(new THREE.BoxGeometry(14, 13, 0.16), glassMat);
  bedNorthGlass.position.set(mx(76), 13.5, -56.5);
  worldGroup.add(bedNorthGlass);
  addBoxCollider('window-bed-glass', 69.0, 83.0, 7.0, 20.0, -57.0, -56.0);

  addStaticBox('window-north-sill', 36, 7.1, -55.5, 20, 0.4, 2.2, woodMedMat, true, true);
  addStaticBox('window-north-frame-t', 36, 19.75, -56.4, 20, 0.5, 0.65, woodMedMat, true, true, false);
  addStaticBox('window-north-frame-l', 26.25, 13.5, -56.4, 0.5, 13, 0.65, woodMedMat, true, true, false);
  addStaticBox('window-north-frame-r', 45.75, 13.5, -56.4, 0.5, 13, 0.65, woodMedMat, true, true, false);
  addStaticBox('window-north-mul-v', 36, 13.5, -56.4, 0.38, 13, 0.42, woodMedMat, true, true, false);
  addStaticBox('window-north-mul-h', 36, 14, -56.4, 20, 0.38, 0.42, woodMedMat, true, true, false);
  const northGlass = new THREE.Mesh(new THREE.BoxGeometry(20, 13, 0.16), glassMat);
  northGlass.position.set(mx(36), 13.5, -56.5);
  worldGroup.add(northGlass);
  addBoxCollider('window-north-glass', 26.0, 46.0, 7.0, 20.0, -57.0, -56.0);

  // West Kitchen wall with framed glass window
  addStaticBox('wall-west-n', -36.5, 13, -15.5, 1, 26, 35, wallMat, false, true);
  addStaticBox('wall-west-s', -36.5, 13, 29.5, 1, 26, 27, wallMat, false, true);
  addStaticBox('wall-west-low', -36.5, 3.5, 9, 1, 7, 14, wallMat, false, true);
  addStaticBox('wall-west-top', -36.5, 22.5, 9, 1, 7, 14, wallMat, false, true);
  addStaticBox('window-west-sill', -35.5, 7.1, 9, 2.2, 0.4, 14, woodMedMat, true, true);
  addStaticBox('window-west-frame-t', -36.4, 18.75, 9, 0.65, 0.5, 14, woodMedMat, true, true, false);
  addStaticBox('window-west-frame-l', -36.4, 13, 2.25, 0.65, 12, 0.5, woodMedMat, true, true, false);
  addStaticBox('window-west-frame-r', -36.4, 13, 15.75, 0.65, 12, 0.5, woodMedMat, true, true, false);
  addStaticBox('window-west-mullion-v', -36.4, 13, 9, 0.42, 12, 0.38, woodMedMat, true, true, false);
  addStaticBox('window-west-mullion-h', -36.4, 13.5, 9, 0.42, 0.38, 14, woodMedMat, true, true, false);
  const westGlass = new THREE.Mesh(new THREE.BoxGeometry(0.16, 12, 14), glassMat);
  westGlass.position.set(mx(-36.5), 13, 9);
  worldGroup.add(westGlass);
  addBoxCollider('window-west-glass', -37.0, -36.0, 7.0, 19.0, 2.0, 16.0);

  // South Wall & Open Front Doorway (x: 48..58)
  addStaticBox('wall-south-w', 5.75, 13, 42.5, 84.5, 26, 1, livingWallMat, true, true);
  addStaticBox('wall-south-e', 75.25, 13, 42.5, 34.5, 26, 1, bedroomWallMat, true, true);
  addStaticBox('wall-south-top', 53, 22.5, 42.5, 10, 7, 1, livingWallMat, true, true);

  addStaticBox('fdoor-frame-l', 47.8, 9.5, 42.5, 0.6, 19, 1.4, woodDarkMat, true, true, false);
  addStaticBox('fdoor-frame-r', 58.2, 9.5, 42.5, 0.6, 19, 1.4, woodDarkMat, true, true, false);
  addStaticBox('fdoor-frame-t', 53, 19.2, 42.5, 11, 0.7, 1.4, woodDarkMat, true, true, false);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(mx(48.1), 0, 42.5);
  doorPivot.rotation.y = house.mirrorX ? 1.15 : -1.15;
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(9.6, 18.6, 0.55), woodMedMat);
  doorPanel.position.set(house.mirrorX ? -4.8 : 4.8, 9.3, 0);
  doorPanel.castShadow = true;
  const doorKnob = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xd4a442, metalness: 0.85, roughness: 0.25 })
  );
  doorKnob.position.set(house.mirrorX ? -8.6 : 8.6, 8.6, 0.45);
  doorPivot.add(doorPanel, doorKnob);
  worldGroup.add(doorPivot);

  // East Bedroom Partition Wall with Doorway to Bathroom (Z: -25..-17) & Doorway to Garage (Z: 28..38)
  addStaticBox('wall-east-n', 92.5, 13, -40.75, 1, 26, 31.5, bedroomWallMat, false, true);
  addStaticBox('wall-east-bath-top', 92.5, 21.5, -21, 1, 9, 8, bedroomWallMat, false, true);
  addStaticBox('wall-east-mid', 92.5, 13, 5.5, 1, 26, 45, bedroomWallMat, false, true);
  addStaticBox('wall-east-s-s', 92.5, 13, 40.25, 1, 26, 4.5, bedroomWallMat, false, true);
  addStaticBox('wall-east-s-top', 92.5, 21.5, 33, 1, 9, 10, bedroomWallMat, false, true);

  // ==================== NEIGHBOR'S BATHROOM ("ВАННАЯ СОСЕДА": X: 92.5..124.5, Z: -32..6) ====================
  const bathTileMat = new THREE.MeshStandardMaterial({ map: textures.bathTile, roughness: 0.32, metalness: 0.05 });
  const bathWallMat = new THREE.MeshStandardMaterial({ color: 0xbfe2e6, roughness: 0.72 });
  const porcelainMat = new THREE.MeshStandardMaterial({ color: 0xf7fbfc, roughness: 0.16, metalness: 0.08 });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x6cd9eb,
    transparent: true,
    opacity: 0.72,
    roughness: 0.08,
    clearcoat: 1.0,
  });

  const bathFloor = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 38.5), bathTileMat);
  bathFloor.rotation.x = -Math.PI / 2;
  bathFloor.position.set(mx(108.5), 0.025, -13);
  bathFloor.receiveShadow = true;
  worldGroup.add(bathFloor);

  const bathCeiling = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 38.5), bathWallMat);
  bathCeiling.rotation.x = Math.PI / 2;
  bathCeiling.position.set(mx(108.5), 26, -13);
  worldGroup.add(bathCeiling);

  addStaticBox('wall-bath-n', 108.5, 13, -32, 32.5, 26, 1, bathWallMat, true, true);
  // Bathroom East Exterior Wall with Frosted Glass Window (Z: -18..-8)
  addStaticBox('wall-bath-e-n', 124.5, 13, -25, 1, 26, 14, bathWallMat, true, true);
  addStaticBox('wall-bath-e-s', 124.5, 13, -1, 1, 26, 14, bathWallMat, true, true);
  addStaticBox('wall-bath-e-low', 124.5, 4.5, -13, 1, 9, 10, bathWallMat, true, true);
  addStaticBox('wall-bath-e-top', 124.5, 22.5, -13, 1, 7, 10, bathWallMat, true, true);
  const bathGlass = new THREE.Mesh(new THREE.BoxGeometry(0.16, 10, 10), glassMat);
  bathGlass.position.set(mx(124.5), 14, -13);
  worldGroup.add(bathGlass);
  addBoxCollider('window-bath-glass', 124.0, 125.0, 9.0, 19.0, -18.0, -8.0);

  // Clawfoot Bathtub + Water + Brass Faucet + Climbable Shower Curtain (X: 114, Z: -24)
  addStaticBox('bath-tub-bottom', 114, 0.9, -24, 14, 1.0, 7.6, porcelainMat, true, true);
  addStaticBox('bath-tub-n', 114, 2.4, -27.3, 14, 3.0, 1.0, porcelainMat, true, true);
  addStaticBox('bath-tub-s', 114, 2.4, -20.7, 14, 3.0, 1.0, porcelainMat, true, true);
  addStaticBox('bath-tub-e', 120.5, 2.4, -24, 1.0, 3.0, 7.6, porcelainMat, true, true);
  addStaticBox('bath-tub-w', 107.5, 2.4, -24, 1.0, 3.0, 7.6, porcelainMat, true, true);
  const bathWater = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.25, 5.4), waterMat);
  bathWater.position.set(mx(114), 2.8, -24);
  worldGroup.add(bathWater);
  const tubCurtain = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 11.5, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x73d4e3, roughness: 0.85, side: THREE.DoubleSide })
  );
  tubCurtain.position.set(mx(107.3), 6.4, -24);
  tubCurtain.castShadow = true;
  worldGroup.add(tubCurtain);
  addClimbable('climb-bath-curtain', 106.4, 108.4, 0.5, 12.2, -26.8, -21.2, -1, 0, 0, 'Шторка в ванной');

  // Giant Toilet (X: 118, Z: -2)
  addStaticBox('toilet-base', 118, 1.8, -2, 3.4, 3.6, 4.2, porcelainMat, true, true);
  addStaticBox('toilet-tank', 120.2, 5.4, -2, 2.2, 4.2, 4.6, porcelainMat, true, true);
  addStaticBox('toilet-rim', 117.2, 3.85, -2, 3.8, 0.55, 3.8, porcelainMat, true, true);
  addHideZone('hide-behind-toilet', 116.0, 122.0, 0, 1.8, -5.8, -3.6, 'За унитазом');

  // Pedestal Sink + Mirror (X: 102, Z: -29)
  addStaticBox('sink-pedestal', 102, 2.6, -29.2, 2.4, 5.2, 2.4, porcelainMat, true, true);
  addStaticBox('sink-basin', 102, 5.8, -28.8, 6.4, 1.4, 4.2, porcelainMat, true, true);
  addStaticBox('bath-mirror-frame', 102, 11.6, -31.2, 7.0, 7.2, 0.35, woodMedMat, false, true, false);
  const mirrorGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(6.0, 6.2),
    new THREE.MeshStandardMaterial({ color: 0xdff5ff, metalness: 0.92, roughness: 0.08 })
  );
  mirrorGlass.position.set(mx(102), 11.6, -30.98);
  worldGroup.add(mirrorGlass);

  const bathRug = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 5.5),
    new THREE.MeshStandardMaterial({ color: 0x3f9aa8, roughness: 0.95 })
  );
  bathRug.rotation.x = -Math.PI / 2;
  bathRug.position.set(mx(109), 0.04, -14);
  bathRug.receiveShadow = true;
  worldGroup.add(bathRug);

  const bathLight = new THREE.PointLight(0xd9f7ff, 1.5, 44, 1.35);
  bathLight.position.set(mx(108.5), 18.5, -13);
  worldGroup.add(bathLight);

  propAnchors.push(
    { x: 102.0, yBottom: 6.5, z: -28.8, elevated: true },
    { x: 114.0, yBottom: 3.9, z: -27.3, elevated: true },
    { x: 120.2, yBottom: 7.5, z: -2.0, elevated: true },
    { x: 109.0, yBottom: 0, z: -13.5, elevated: false }
  );

  // ==================== ATTACHED GNOME & NEIGHBOR GARAGE (X: 92.5..124.5, Z: 6..42.5) ====================
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x767a80, roughness: 0.92, metalness: 0.04 });
  const garageWallMat = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.88 });
  const garageDoorMat = new THREE.MeshStandardMaterial({ color: 0xc9cfd4, roughness: 0.52, metalness: 0.25 });
  const redToolMat = new THREE.MeshStandardMaterial({ color: 0xb83428, roughness: 0.46, metalness: 0.2 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x202328, roughness: 0.88 });
  const helipadYellowMat = new THREE.MeshStandardMaterial({
    color: 0xf2be3d,
    emissive: 0xd1941a,
    emissiveIntensity: 0.25,
    roughness: 0.5,
  });

  const garageFloorMesh = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 36.5), concreteMat);
  garageFloorMesh.rotation.x = -Math.PI / 2;
  garageFloorMesh.position.set(mx(108.5), 0.02, 24.25);
  garageFloorMesh.receiveShadow = true;
  worldGroup.add(garageFloorMesh);

  const drivewayPad = new THREE.Mesh(new THREE.PlaneGeometry(25, 28), concreteMat);
  drivewayPad.rotation.x = -Math.PI / 2;
  drivewayPad.position.set(mx(108.5), 0.015, 57);
  drivewayPad.receiveShadow = true;
  worldGroup.add(drivewayPad);

  const garageCeiling = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 36.5), garageWallMat);
  garageCeiling.rotation.x = Math.PI / 2;
  garageCeiling.position.set(mx(108.5), 26, 24.25);
  worldGroup.add(garageCeiling);

  // Garage Exterior Walls + Cracked-Open Rolling Garage Door (0..5.2 gap underneath!)
  addStaticBox('wall-garage-n', 108.5, 13, 6, 32.5, 26, 1, garageWallMat, true, true);
  addStaticBox('wall-garage-e', 124.5, 13, 24.25, 1, 26, 37, garageWallMat, true, true);
  addStaticBox('wall-garage-sw', 94.75, 13, 42.5, 4.5, 26, 1, garageWallMat, true, true);
  addStaticBox('wall-garage-se', 122.25, 13, 42.5, 4.5, 26, 1, garageWallMat, true, true);
  addStaticBox('garage-door-panel', 108.5, 15.6, 42.5, 23, 20.8, 0.7, garageDoorMat, true, true);
  [7.2, 10.4, 13.6, 16.8, 20.0].forEach((gy, gi) => {
    addStaticBox(`garage-door-rib-${gi}`, 108.5, gy, 42.95, 22.8, 0.22, 0.25, darkMetalMat, false, true, false);
  });

  // Helipad Landing Circle + H emblem inside Garage
  const helipadRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.05, 28), helipadYellowMat);
  helipadRing.rotation.x = -Math.PI / 2;
  helipadRing.position.set(mx(108.5), 0.04, 26);
  worldGroup.add(helipadRing);
  const hBarL = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 2.5), helipadYellowMat);
  hBarL.rotation.x = -Math.PI / 2;
  hBarL.position.set(mx(107.7), 0.045, 26);
  const hBarR = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 2.5), helipadYellowMat);
  hBarR.rotation.x = -Math.PI / 2;
  hBarR.position.set(mx(109.3), 0.045, 26);
  const hBarMid = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.45), helipadYellowMat);
  hBarMid.rotation.x = -Math.PI / 2;
  hBarMid.position.set(mx(108.5), 0.045, 26);
  worldGroup.add(hBarL, hBarR, hBarMid);

  // Garage Mechanic Workbench, Tool Chest, Tires, Oil Drum & Drone Charging Dock
  addStaticBox('garage-bench-top', 117.5, 2.3, 11.2, 9.6, 0.4, 4.4, woodMedMat, true, true);
  [
    [113.2, 9.4],
    [121.8, 9.4],
    [113.2, 13.0],
    [121.8, 13.0],
  ].forEach(([gx, gz], gi) => {
    addStaticBox(`garage-bench-leg-${gi}`, gx, 1.05, gz, 0.55, 2.1, 0.55, darkMetalMat, true, true);
  });
  addStaticBox('garage-toolbox', 120.2, 3.35, 11.0, 2.8, 1.7, 1.8, redToolMat, true, true);
  addStaticBox('garage-pegboard', 117.5, 6.2, 7.0, 9.2, 5.2, 0.25, woodDarkMat, false, true, false);

  // Climbable Tire Stack leading onto Mechanic Workbench
  [0.55, 1.65].forEach((ty, ti) => {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.55, 10, 18), rubberMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(mx(111.5), ty, 11.2);
    tire.castShadow = true;
    worldGroup.add(tire);
    addBoxCollider(`garage-tire-${ti}`, 109.6, 113.4, ty - 0.55, ty + 0.55, 9.3, 13.1);
  });
  addClimbable('climb-garage-tires', 109.2, 113.8, 0.1, 2.65, 9.0, 13.5, 0, 0, 1, 'Стопка шин к верстаку гаража');

  // Blue oil barrel & car wheel jack
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 4.2, 14),
    new THREE.MeshStandardMaterial({ color: 0x2c5c8f, roughness: 0.48, metalness: 0.35 })
  );
  barrel.position.set(mx(97.5), 2.1, 11.0);
  barrel.castShadow = true;
  worldGroup.add(barrel);
  addBoxCollider('garage-barrel', 95.9, 99.1, 0, 4.2, 9.4, 12.6);

  // Glowing Mavic Drone Charging Pad + Display Drone on Mechanic Bench
  const droneDockPos = new THREE.Vector3(mx(116.5), 2.52, 11.2);
  const dockBase = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 0.16, 16), darkMetalMat);
  dockBase.position.set(droneDockPos.x, 2.56, droneDockPos.z);
  const dockRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.07, 8, 20),
    new THREE.MeshStandardMaterial({
      color: 0x5effa8,
      emissive: 0x26e678,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    })
  );
  dockRing.rotation.x = Math.PI / 2;
  dockRing.position.set(droneDockPos.x, 2.64, droneDockPos.z);
  worldGroup.add(dockBase, dockRing);

  const dockDrone = createMavicDroneModel();
  dockDrone.group.position.set(droneDockPos.x, 2.84, droneDockPos.z);
  dockDrone.group.scale.setScalar(1.35);
  worldGroup.add(dockDrone.group);

  // Industrial warm ceiling light inside Garage
  const garageLight = new THREE.PointLight(0xffdfb0, 1.5, 48, 1.35);
  garageLight.position.set(mx(108.5), 18, 24);
  worldGroup.add(garageLight);
  const garageLampShade = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.2, 14), darkMetalMat);
  garageLampShade.position.set(mx(108.5), 23.2, 24);
  worldGroup.add(garageLampShade);

  // Baseboards
  addStaticBox('bb-west', -35.8, 0.8, -15.5, 0.35, 1.6, 35, baseboardMat, false, true, false);
  addStaticBox('bb-east', 91.8, 0.8, 17, 0.35, 1.6, 21, baseboardMat, false, true, false);
  addStaticBox('bb-north-k', -11, 0.8, -31.8, 49, 1.6, 0.35, baseboardMat, false, true, false);

  // Interior Room Dividers (consistent corridor ring across all 6 layouts)
  addStaticBox('div-kl-n', 14, 13, -23.5, 1, 26, 17, wallMat, true, true);
  addStaticBox('div-kl-s', 14, 13, 18.5, 1, 26, 15, wallMat, true, true);
  addStaticBox('div-kl-top', 14, 23, -2, 1, 6, 26, wallMat, true, true);

  addStaticBox('div-ls-w', 19, 13, -32, 10, 26, 1, livingWallMat, true, true);
  addStaticBox('div-ls-e', 51, 13, -32, 14, 26, 1, livingWallMat, true, true);
  addStaticBox('div-ls-top', 34, 23, -32, 20, 6, 1, livingWallMat, true, true);

  addStaticBox('div-lb-1', 58, 13, -53, 1, 26, 6, bedroomWallMat, true, true);
  addStaticBox('div-lb-2', 58, 13, -25, 1, 26, 22, bedroomWallMat, true, true);
  addStaticBox('div-lb-3', 58, 13, 18, 1, 26, 16, bedroomWallMat, true, true);
  addStaticBox('div-lb-top', 58, 23, -15, 1, 6, 82, bedroomWallMat, true, true);

  addStaticBox('div-kh-w', -22, 13, 26, 28, 26, 1, wallMat, true, true);
  addStaticBox('div-kh-e', 52, 13, 26, 28, 26, 1, livingWallMat, true, true);
  addStaticBox('div-kh-ee', 88, 13, 26, 8, 26, 1, bedroomWallMat, true, true);
  addStaticBox('div-kh-top', 42, 23, 26, 100, 6, 1, wallMat, true, true);

  // ==================== OUTDOOR FRONT YARD & PICKET FENCE ====================
  addStaticBox('porch-deck', 53, 0.16, 45.2, 16, 0.32, 5.4, woodMedMat, true, true);
  addStaticBox('yard-fence-s', 44, 3.2, 74, 172, 6.4, 1.0, fenceMat, true, true);
  addStaticBox('yard-fence-w', -42, 3.2, 58, 1.0, 6.4, 32, fenceMat, true, true);
  addStaticBox('yard-fence-e', 130, 3.2, 58, 1.0, 6.4, 32, fenceMat, true, true);

  addStaticBox('mailbox-post', 63, 4.5, 53, 0.8, 9, 0.8, woodDarkMat, true, true);
  addStaticBox(
    'mailbox-box',
    63,
    9.6,
    53,
    2.2,
    2.0,
    3.6,
    new THREE.MeshStandardMaterial({ color: pal.mailbox, roughness: 0.55 }),
    true,
    true
  );
  addStaticBox('porch-lamp-post', 44, 5.5, 46, 0.6, 11, 0.6, darkMetalMat, true, true);
  const porchGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffefc2, emissive: 0xffa834, emissiveIntensity: 1.65, roughness: 0.2 })
  );
  porchGlow.position.set(mx(44), 11.4, 46);
  worldGroup.add(porchGlow);
  const porchPoint = new THREE.PointLight(0xffc978, 0.85, 22, 1.4);
  porchPoint.position.set(mx(44), 10.6, 46);
  worldGroup.add(porchPoint);

  const planterPotMat = new THREE.MeshStandardMaterial({ color: 0x994e32, roughness: 0.8 });
  const petalColors = [0xe85a4f, 0xf2be3d, 0x7b63c7, 0xf282a8, 0x5cc7e8];
  [45.8, 60.2].forEach((px, pidx) => {
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.85, 1.8, 12), planterPotMat);
    planter.position.set(mx(px), 0.9, 44.5);
    planter.castShadow = true;
    worldGroup.add(planter);
    addBoxCollider(`porch-planter-${pidx}`, px - 1.15, px + 1.15, 0, 1.8, 43.35, 45.65);
    for (let f = 0; f < 5; f++) {
      const a = (f / 5) * Math.PI * 2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6), vineMat);
      stem.position.set(mx(px) + Math.cos(a) * 0.45, 2.2, 44.5 + Math.sin(a) * 0.45);
      const bloom = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.28, 0),
        new THREE.MeshStandardMaterial({
          color: petalColors[(f + pidx + house.id) % petalColors.length],
          roughness: 0.65,
        })
      );
      bloom.position.set(mx(px) + Math.cos(a) * 0.45, 2.7, 44.5 + Math.sin(a) * 0.45);
      worldGroup.add(stem, bloom);
    }
  });

  // ==================== GARDEN SHED ("САРАЙ ВО ДВОРЕ": X: -28..-10, Z: 48..66) ====================
  const shedWoodMat = new THREE.MeshStandardMaterial({ map: textures.shedWood, roughness: 0.88 });
  const shedRoofMat = new THREE.MeshStandardMaterial({ color: 0x5c3626, roughness: 0.82 });
  const shedFloor = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), concreteMat);
  shedFloor.rotation.x = -Math.PI / 2;
  shedFloor.position.set(mx(-19), 0.02, 57);
  shedFloor.receiveShadow = true;
  worldGroup.add(shedFloor);

  addStaticBox('shed-wall-w', -28, 6.5, 57, 1, 13, 18, shedWoodMat, true, true);
  addStaticBox('shed-wall-n', -19, 6.5, 48, 18, 13, 1, shedWoodMat, true, true);
  addStaticBox('shed-wall-s', -19, 6.5, 66, 18, 13, 1, shedWoodMat, true, true);
  // East wall with open doorway (Z: 53.5..60.5)
  addStaticBox('shed-wall-en', -10, 6.5, 50.75, 1, 13, 5.5, shedWoodMat, true, true);
  addStaticBox('shed-wall-es', -10, 6.5, 63.25, 1, 13, 5.5, shedWoodMat, true, true);
  addStaticBox('shed-wall-etop', -10, 10.75, 57, 1, 4.5, 7, shedWoodMat, true, true);
  addStaticBox('shed-roof', -19, 13.4, 57, 20.5, 0.9, 20.5, shedRoofMat, true, true);

  // Shed Tool Shelf + Climbable Wooden Ladder + Wheelbarrow
  addStaticBox('shed-shelf-top', -24.5, 4.2, 52, 5.6, 0.45, 5.2, woodMedMat, true, true);
  [
    [-26.9, 49.8],
    [-22.1, 49.8],
    [-26.9, 54.2],
    [-22.1, 54.2],
  ].forEach(([sx, sz], si) => {
    addStaticBox(`shed-shelf-leg-${si}`, sx, 2.0, sz, 0.45, 4.0, 0.45, woodDarkMat, true, true);
  });
  addHideZone('hide-under-shed-shelf', -27.2, -21.8, 0, 2.2, 49.4, 54.6, 'Под верстаком в сарае');
  addClimbable('climb-shed-shelf', -22.2, -20.8, 0.1, 4.5, 50.4, 53.6, 1, 0, 0, 'Стеллаж в сарае');

  // Doghouse in Front Yard (X: 18, Z: 54)
  const doghousePos = new THREE.Vector3(mx(18), 0, 54);
  const doghouseMat = new THREE.MeshStandardMaterial({ color: 0xb84635, roughness: 0.78 });
  addStaticBox('doghouse-w', 15.8, 2.2, 54, 0.5, 4.4, 5.2, woodMedMat, true, true);
  addStaticBox('doghouse-e', 20.2, 2.2, 54, 0.5, 4.4, 5.2, woodMedMat, true, true);
  addStaticBox('doghouse-n', 18.0, 2.2, 51.6, 4.8, 4.4, 0.5, woodMedMat, true, true);
  addStaticBox('doghouse-roof', 18.0, 4.7, 54, 5.6, 0.7, 6.0, doghouseMat, true, true);

  propAnchors.push(
    { x: -24.5, yBottom: 4.45, z: 52.0, elevated: true },
    { x: -20.0, yBottom: 0, z: 61.5, elevated: false },
    { x: -16.5, yBottom: 0, z: 52.5, elevated: false }
  );

  // Instanced Stylized Grass Tufts across the front yard (skip driveway, shed & doghouse!)
  const tuftGeo = new THREE.ConeGeometry(0.22, 1.15, 5);
  tuftGeo.translate(0, 0.57, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ color: mood.grassTuftColor, roughness: 0.85 });
  const grassCount = 180;
  const grassInst = new THREE.InstancedMesh(tuftGeo, tuftMat, grassCount);
  grassInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tuftColor = new THREE.Color();
  let placedGrass = 0;
  const pathCenterX = mx(53);
  for (let i = 0; i < grassCount * 3 && placedGrass < grassCount; i++) {
    const rawGx = -36 + ((i * 73.13 + house.treeSeed) % 128);
    const gz = 46 + ((i * 31.77 + house.id * 5) % 26);
    const gx = mx(rawGx);
    if (Math.abs(gx - pathCenterX) < 7.2 && gz < 72) continue;
    if (rawGx >= -29.5 && rawGx <= -8.5 && gz >= 46.5 && gz <= 67.5) continue;
    if (rawGx >= 14.5 && rawGx <= 21.5 && gz >= 50.5 && gz <= 58.0) continue;
    if (rawGx >= 95 && rawGx <= 123 && gz >= 43 && gz <= 72) continue;
    dummy.position.set(gx, 0, gz);
    dummy.rotation.set(Math.sin(i) * 0.14, (i * 1.618) % (Math.PI * 2), Math.cos(i) * 0.14);
    const s = 0.75 + (i % 5) * 0.22;
    dummy.scale.set(s, s * (0.85 + (i % 3) * 0.25), s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass, dummy.matrix);
    tuftColor.setHSL(mood.grassHueBase + ((i % 7) - 3) * 0.012, 0.48, 0.44 + (i % 4) * 0.04);
    grassInst.setColorAt(placedGrass, tuftColor);
    placedGrass++;
  }
  grassInst.count = placedGrass;
  grassInst.instanceMatrix.needsUpdate = true;
  if (grassInst.instanceColor) grassInst.instanceColor.needsUpdate = true;
  grassInst.computeBoundingSphere();
  worldGroup.add(grassInst);

  // ==================== STYLIZED TREES, BUSHES & VOLUMETRIC SUNBEAMS ====================
  const animatedUniforms: Array<{ uTime: { value: number } }> = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x694228, roughness: 0.88 });
  const leafLightMat = new THREE.MeshStandardMaterial({ color: mood.leafLight, roughness: 0.78 });
  const leafMidMat = new THREE.MeshStandardMaterial({ color: mood.leafMid, roughness: 0.82 });
  const leafDarkMat = new THREE.MeshStandardMaterial({ color: mood.leafDark, roughness: 0.86 });

  const spawnCartoonTree = (tx: number, tz: number, scale = 1.0) => {
    const tree = new THREE.Group();
    tree.position.set(mx(tx), 0, tz);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * scale, 1.65 * scale, 12 * scale, 10), trunkMat);
    trunk.position.y = 6 * scale;
    trunk.castShadow = true;
    tree.add(trunk);

    const puffs: Array<[number, number, number, number, THREE.Material]> = [
      [0, 14.2 * scale, 0, 5.2 * scale, leafMidMat],
      [-3.1 * scale, 12.2 * scale, 1.6 * scale, 3.8 * scale, leafLightMat],
      [3.2 * scale, 12.6 * scale, -1.4 * scale, 3.9 * scale, leafLightMat],
      [0.4 * scale, 17.8 * scale, 0.4 * scale, 3.6 * scale, leafLightMat],
      [0, 11.5 * scale, -2.5 * scale, 3.5 * scale, leafDarkMat],
    ];
    for (const [px, py, pz, r, m] of puffs) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m);
      puff.position.set(px, py, pz);
      puff.castShadow = true;
      tree.add(puff);
    }
    addCartoonOutline(tree, 0.055 * scale, 0x1b2116);
    worldGroup.add(tree);
  };

  const spawnCartoonBush = (bx: number, bz: number, scale = 1.0) => {
    const bush = new THREE.Group();
    bush.position.set(mx(bx), 0, bz);
    [
      [0, 1.6 * scale, 0, 2.2 * scale, leafMidMat],
      [-1.5 * scale, 1.2 * scale, 0.4 * scale, 1.5 * scale, leafLightMat],
      [1.4 * scale, 1.3 * scale, -0.3 * scale, 1.6 * scale, leafDarkMat],
    ].forEach(([px, py, pz, r, m]) => {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r as number, 1), m as THREE.Material);
      puff.position.set(px as number, py as number, pz as number);
      puff.castShadow = true;
      bush.add(puff);
    });
    addCartoonOutline(bush, 0.035 * scale, 0x1b2116);
    worldGroup.add(bush);
  };

  const tJitter = (rng() - 0.5) * 6;
  spawnCartoonTree(78 + tJitter * 0.5, 63, 1.05 + rng() * 0.25);
  spawnCartoonTree(34 - tJitter * 0.4, 66, 0.95 + rng() * 0.25);
  spawnCartoonTree(-36 + tJitter * 0.3, 66, 1.1 + rng() * 0.25);
  spawnCartoonTree(-50, 9 + tJitter, 1.05 + rng() * 0.2);
  spawnCartoonTree(36 + tJitter, -72, 1.15 + rng() * 0.25);
  spawnCartoonTree(136 + tJitter * 0.4, -16, 1.1 + rng() * 0.25);
  spawnCartoonTree(136, 24 - tJitter * 0.5, 0.95 + rng() * 0.25);
  spawnCartoonBush(41, 47, 0.9);
  spawnCartoonBush(65, 47, 0.85);
  spawnCartoonBush(10 + tJitter * 0.5, 58, 1.05);
  spawnCartoonBush(86 - tJitter * 0.4, 56, 1.0);

  const addSunbeamShaft = (
    x: number,
    y: number,
    z: number,
    width: number,
    length: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    colorHex = 0xffe4a8,
    opacity = 0.16
  ) => {
    const { material, uniforms } = createSunbeamMaterial(colorHex, opacity);
    animatedUniforms.push(uniforms);
    const geo = new THREE.PlaneGeometry(width, length);
    const g = new THREE.Group();
    g.position.set(mx(x), y, z);
    g.rotation.set(rotX, mrot(rotY), mrot(rotZ));
    const p1 = new THREE.Mesh(geo, material);
    const p2 = new THREE.Mesh(geo, material);
    p2.rotation.y = Math.PI / 2;
    p1.userData.skipStylize = true;
    p1.userData.skipOutline = true;
    p2.userData.skipStylize = true;
    p2.userData.skipOutline = true;
    g.add(p1, p2);
    worldGroup.add(g);
  };

  const beamCol = mood.sunColor;
  addSunbeamShaft(112, 10.5, -13, 10, 22, 0.08, 0, 0.82, mood.hemiSky, 0.14);
  addSunbeamShaft(76, 10.5, -46, 12, 20, -0.76, 0, 0, beamCol, 0.14);
  addSunbeamShaft(36, 10.0, -47, 14, 20, -0.78, 0, 0, mood.hemiSky, 0.12);
  addSunbeamShaft(-26, 9.5, 9, 10, 22, 0, 0, -0.82, beamCol, 0.13);
  addSunbeamShaft(53, 8.5, 36, 8, 18, 0.72, 0, 0, beamCol, 0.13);

  const kitchenBounce = new THREE.PointLight(mood.chandelierColor, 0.92, 52, 1.35);
  kitchenBounce.position.set(mx(-14), 15, -10);
  const livingBounce = new THREE.PointLight(mood.chandelierColor, 0.88, 54, 1.35);
  livingBounce.position.set(mx(36), 16, -6);
  const eastSkyBounce = new THREE.PointLight(mood.hemiSky, 0.7, 36, 1.4);
  eastSkyBounce.position.set(mx(78), 14, -42);
  const northSkyBounce = new THREE.PointLight(mood.hemiSky, 0.62, 34, 1.4);
  northSkyBounce.position.set(mx(36), 14, -50);
  worldGroup.add(kitchenBounce, livingBounce, eastSkyBounce, northSkyBounce);

  // ==================== GNOME BURROW ====================
  const burrowWallMat = new THREE.MeshStandardMaterial({
    map: textures.burrowStone,
    normalMap: textures.burrowStoneNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughness: 0.94,
  });
  addStaticBox('burrow-w', -24.5, 3.5, 36, 1, 7, 12, burrowWallMat, true, true);
  addStaticBox('burrow-e', -9.5, 3.5, 36, 1, 7, 12, burrowWallMat, true, true);
  addStaticBox('burrow-roof', -17, 6.8, 36, 15, 0.6, 12.5, woodDarkMat, true, true);
  [-21, -17, -13].forEach((bx, bi) => {
    addStaticBox(`burrow-beam-${bi}`, bx, 6.3, 36, 0.55, 0.55, 11.6, woodDarkMat, false, true, false);
  });
  addStaticBox('burrow-front-l', -21.5, 3.5, 30, 6, 7, 0.8, baseboardMat, true, true);
  addStaticBox('burrow-front-r', -12.5, 3.5, 30, 6, 7, 0.8, baseboardMat, true, true);
  addStaticBox('burrow-front-top', -17, 4.85, 30, 3.2, 4.3, 0.8, baseboardMat, true, true);

  addStaticBox('arch-l', -18.55, 1.35, 29.8, 0.28, 2.7, 1.1, woodDarkMat, true, true, false);
  addStaticBox('arch-r', -15.45, 1.35, 29.8, 0.28, 2.7, 1.1, woodDarkMat, true, true, false);
  addStaticBox('arch-top', -17, 2.75, 29.8, 3.4, 0.35, 1.1, woodDarkMat, true, true, false);

  const stashCenter = new THREE.Vector3(mx(-17), 0, 33.2);
  const stashMat = new THREE.MeshStandardMaterial({ color: 0x8f3427, roughness: 0.92 });
  const stashDisc = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.06, 20), stashMat);
  stashDisc.position.set(stashCenter.x, 0.03, stashCenter.z);
  stashDisc.receiveShadow = true;
  worldGroup.add(stashDisc);
  const stashRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, 0.07, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xd4a442, roughness: 0.45, metalness: 0.45 })
  );
  stashRing.rotation.x = Math.PI / 2;
  stashRing.position.set(stashCenter.x, 0.07, stashCenter.z);
  worldGroup.add(stashRing);

  const highGnomePos = new THREE.Vector3(mx(-21.0), 0, 34.4);
  const highGnomeRig = createHighGnomeModel(textures);
  highGnomeRig.group.position.copy(highGnomePos);
  highGnomeRig.group.rotation.y = mrot(0.65);
  worldGroup.add(highGnomeRig.group);
  addBoxCollider('high-gnome-col', -21.7, -20.3, 0, 2.4, 33.7, 35.1);

  const companionRigs: Array<{ rig: GnomeNpcRig; basePos: THREE.Vector3; baseYaw: number }> = [];
  const buddy1Pos = new THREE.Vector3(mx(-21.8), 0, 39.2);
  const buddy1 = createHighGnomeModel(textures, { hatColor: 0x3b7a48, tunicColor: 0x6b4b32, hasStaff: false });
  buddy1.group.position.copy(buddy1Pos);
  buddy1.group.rotation.y = mrot(2.4);
  worldGroup.add(buddy1.group);
  companionRigs.push({ rig: buddy1, basePos: buddy1Pos, baseYaw: mrot(2.4) });
  addBoxCollider('buddy1-col', -22.3, -21.3, 0, 2.2, 38.7, 39.7);

  const buddy2Pos = new THREE.Vector3(mx(-12.2), 0, 39.5);
  const buddy2 = createHighGnomeModel(textures, { hatColor: 0xc98b2c, tunicColor: 0x455a44, hasStaff: false });
  buddy2.group.position.copy(buddy2Pos);
  buddy2.group.rotation.y = mrot(-2.5);
  worldGroup.add(buddy2.group);
  companionRigs.push({ rig: buddy2, basePos: buddy2Pos, baseYaw: mrot(-2.5) });
  addBoxCollider('buddy2-col', -12.7, -11.7, 0, 2.2, 39.0, 40.0);

  const workbenchPos = new THREE.Vector3(mx(-12.6), 0, 35.0);
  const workbench = createWorkbenchModel(textures);
  workbench.position.copy(workbenchPos);
  workbench.rotation.y = mrot(-Math.PI / 2);
  worldGroup.add(workbench);
  addBoxCollider('workbench-col', -13.6, -11.6, 0, 1.8, 33.5, 36.5);

  const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.38, 0.35, 12), darkMetalMat);
  brazier.position.set(mx(-19.5), 0.18, 37.6);
  worldGroup.add(brazier);
  const burrowFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.65, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffc766,
      emissive: 0xff7718,
      emissiveIntensity: 1.8,
      roughness: 0.25,
    })
  );
  burrowFlame.position.set(mx(-19.5), 0.62, 37.6);
  worldGroup.add(burrowFlame);

  const cauldronBody = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), darkMetalMat);
  cauldronBody.scale.set(1.05, 0.82, 1.05);
  cauldronBody.position.set(mx(-19.5), 1.15, 37.6);
  const cauldronRim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 16), darkMetalMat);
  cauldronRim.rotation.x = Math.PI / 2;
  cauldronRim.position.set(mx(-19.5), 1.42, 37.6);
  const cauldronSoup = new THREE.Mesh(
    new THREE.CircleGeometry(0.33, 14),
    new THREE.MeshStandardMaterial({ color: 0x62e89c, emissive: 0x2fb86c, emissiveIntensity: 1.25, roughness: 0.2 })
  );
  cauldronSoup.rotation.x = -Math.PI / 2;
  cauldronSoup.position.set(mx(-19.5), 1.4, 37.6);
  worldGroup.add(cauldronBody, cauldronRim, cauldronSoup);

  const cauldronBubbles: THREE.Mesh[] = [];
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0x9cf7c0,
    emissive: 0x45d682,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  for (let i = 0; i < 4; i++) {
    const bub = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), bubbleMat);
    bub.position.set(mx(-19.5) + Math.cos(i * 1.7) * 0.14, 1.48 + i * 0.14, 37.6 + Math.sin(i * 1.7) * 0.14);
    worldGroup.add(bub);
    cauldronBubbles.push(bub);
  }

  const shroomCapMat = new THREE.MeshStandardMaterial({
    color: 0x7df2d6,
    emissive: 0x2ec4a6,
    emissiveIntensity: 1.45,
    roughness: 0.3,
  });
  const shroomStemMat = new THREE.MeshStandardMaterial({ color: 0xded3be, roughness: 0.8 });
  [
    [-23.6, 31.4, 0.9],
    [-23.7, 36.2, 1.15],
    [-23.5, 40.8, 0.85],
    [-10.4, 31.6, 1.0],
    [-10.3, 37.8, 1.1],
    [-10.5, 41.0, 0.8],
  ].forEach(([sxPos, mz, ms]) => {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * ms, 0.08 * ms, 0.32 * ms, 7), shroomStemMat);
    stem.position.set(mx(sxPos), 0.16 * ms, mz);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24 * ms, 0.22 * ms, 9), shroomCapMat);
    cap.position.set(mx(sxPos), 0.36 * ms, mz);
    worldGroup.add(stem, cap);
  });

  const burrowLight = new THREE.PointLight(0xffa94d, 2.2, 20, 1.5);
  burrowLight.position.set(mx(-18.5), 3.6, 36.6);
  worldGroup.add(burrowLight);

  // ==================== SHARED KITCHEN COUNTERS & FRIDGE ====================
  addStaticBox('counter-base', -7, 4.0, -27.5, 34, 8.0, 9.0, cabinetMat, true, true);
  addStaticBox('counter-corner-top', -29.5, 4.7, -27.5, 11, 6.5, 9.0, cabinetMat, true, true);
  addHideZone('hide-corner-cabinet', -35, -24, 0, 1.5, -32, -23, 'Под кухонным шкафом');

  addStaticBox('counter-marble', -12, 8.25, -27.5, 46, 0.5, 9.4, marbleMat, true, true);
  addStaticBox('stove-body', -10, 4.25, -27.2, 8.2, 8.5, 9.8, steelMat, true, true);
  const ovenDoor = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4.8, 0.3), darkMetalMat);
  ovenDoor.position.set(mx(-10), 3.6, -22.25);
  worldGroup.add(ovenDoor);
  [
    [-12.2, -29.2],
    [-7.8, -29.2],
    [-12.2, -25.2],
    [-7.8, -25.2],
  ].forEach(([bx, bz]) => {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.25, 16), darkMetalMat);
    burner.position.set(mx(bx), 8.62, bz);
    worldGroup.add(burner);
  });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.35, 2.2, 18), steelMat);
  pot.position.set(mx(-12.2), 9.8, -25.2);
  pot.castShadow = true;
  worldGroup.add(pot);
  addBoxCollider('pot-col', -13.7, -10.7, 8.5, 11.0, -26.7, -23.7);

  const sinkRim = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.35, 6.4), steelMat);
  sinkRim.position.set(mx(4.5), 8.55, -27.2);
  worldGroup.add(sinkRim);
  const waterPool = new THREE.Mesh(
    new THREE.PlaneGeometry(6.0, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x3b6f78, roughness: 0.12, metalness: 0.2 })
  );
  waterPool.rotation.x = -Math.PI / 2;
  waterPool.position.set(mx(4.5), 8.73, -27.2);
  worldGroup.add(waterPool);
  const faucetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(mx(4.5), 8.6, -30.5),
    new THREE.Vector3(mx(4.5), 11.8, -30.4),
    new THREE.Vector3(mx(4.5), 12.2, -28.6),
    new THREE.Vector3(mx(4.5), 10.9, -28.0),
  ]);
  const faucet = new THREE.Mesh(new THREE.TubeGeometry(faucetCurve, 16, 0.24, 10, false), steelMat);
  faucet.castShadow = true;
  worldGroup.add(faucet);

  addStaticBox('upper-cab-1', -21, 18.6, -29.5, 18, 7.6, 5.0, cabinetMat, true, true);
  addStaticBox('upper-cab-2', 1, 18.6, -29.5, 16, 7.6, 5.0, cabinetMat, true, true);

  const underCabStrip = new THREE.Mesh(
    new THREE.BoxGeometry(36, 0.16, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffca7a, emissiveIntensity: 1.35 })
  );
  underCabStrip.position.set(mx(-10), 14.7, -27.2);
  worldGroup.add(underCabStrip);

  const toaster = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 1.7), steelMat);
  toaster.position.set(mx(-25.5), 9.45, -27.2);
  toaster.castShadow = true;
  worldGroup.add(toaster);
  addBoxCollider('toaster-col', -26.8, -24.2, 8.5, 10.4, -28.05, -26.35);

  const copperMat = new THREE.MeshStandardMaterial({ color: 0xc96f38, roughness: 0.25, metalness: 0.88 });
  const kettle = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 2.1, 14), copperMat);
  kettle.position.set(mx(-7.8), 9.65, -25.2);
  kettle.castShadow = true;
  worldGroup.add(kettle);
  addBoxCollider('kettle-col', -9.1, -6.5, 8.5, 10.7, -26.5, -23.9);

  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(10, 0.24, 3.6), darkMetalMat);
  rackFrame.position.set(mx(-11), 21.8, -3);
  worldGroup.add(rackFrame);
  [-14.5, -11, -7.5].forEach((rx, rIdx) => {
    const rodH = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6), darkMetalMat);
    rodH.position.set(mx(rx), 23.9, -3);
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.85, rIdx === 1 ? 1.2 : 0.45, 14), copperMat);
    pan.position.set(mx(rx), 20.6, -3 + (rIdx % 2 === 0 ? 0.6 : -0.6));
    worldGroup.add(rodH, pan);
  });

  const towel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7.2, 0.2), curtainMat);
  towel.position.set(mx(-20), 5.0, -22.65);
  towel.castShadow = true;
  worldGroup.add(towel);
  addClimbable('climb-kitchen-towel', -21.5, -18.5, 0.5, 8.6, -23.3, -21.8, 0, 0, 1, 'Кухонное полотенце');

  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(mx(10.5), 0.15, -14.5),
    new THREE.Vector3(mx(10.2), 2.2, -17.5),
    new THREE.Vector3(mx(10.4), 5.4, -20.5),
    new THREE.Vector3(mx(10.0), 8.6, -23.2),
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 20, 0.22, 8, false), darkMetalMat);
  cable.castShadow = true;
  worldGroup.add(cable);
  addClimbable('climb-counter-cable', 9.2, 11.6, 0.2, 8.8, -23.8, -14.0, 0, 0, 1, 'Толстый провод к столешнице');

  addStaticBox('fridge-body', -30.4, 11.2, -13, 9.4, 20.2, 9.8, fridgeMat, true, true);
  [
    [-34.5, -17.2],
    [-26.3, -17.2],
    [-34.5, -8.8],
    [-26.3, -8.8],
  ].forEach(([fx, fz]) => {
    addStaticBox(`fridge-leg-${fx}-${fz}`, fx, 0.55, fz, 0.8, 1.1, 0.8, darkMetalMat, true, true);
  });
  const fridgeSeam = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 9.9), darkMetalMat);
  fridgeSeam.position.set(mx(-25.65), 14.5, -13);
  worldGroup.add(fridgeSeam);
  const handleTop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.6, 10), steelMat);
  handleTop.position.set(mx(-25.3), 17.5, -9.2);
  const handleBot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.2, 10), steelMat);
  handleBot.position.set(mx(-25.3), 9.8, -9.2);
  worldGroup.add(handleTop, handleBot);
  addHideZone('hide-under-fridge', -35.2, -25.6, 0, 1.15, -18, -8, 'Под холодильником');

  const bookColors = [0x943028, 0x2c5c82, 0x3f7548, 0x997028];
  const makeBook = (
    id: string,
    x: number,
    yBottom: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    colorIdx: number
  ) => {
    const mat = new THREE.MeshStandardMaterial({ color: bookColors[colorIdx % bookColors.length], roughness: 0.78 });
    return addStaticBox(id, x, yBottom + sy / 2, z, sx, sy, sz, mat, true, true);
  };

  const cerealMat = new THREE.MeshStandardMaterial({ map: textures.cerealBox, roughness: 0.78 });

  // Loot & Insect surface anchors populated dynamically per wingMode
  propAnchors.push(
    // Countertops (always same across wingModes)
    { x: -20.5, yBottom: 8.5, z: -26.0, elevated: true },
    { x: 7.5, yBottom: 8.5, z: -24.5, elevated: true },
    { x: -25.0, yBottom: 8.5, z: -25.0, elevated: true },
    { x: -1.5, yBottom: 8.5, z: -24.2, elevated: true },
    { x: -30.0, yBottom: 8.5, z: -26.5, elevated: true },
    // Kitchen & corridor floor
    { x: -29.0, yBottom: 0, z: -13.0, elevated: false },
    { x: -32.5, yBottom: 0, z: 12.0, elevated: false },
    { x: -4.0, yBottom: 0, z: 18.0, elevated: false },
    { x: 16.0, yBottom: 0, z: 20.0, elevated: false }
  );

  // ==================== WINGMODE-SPECIFIC FURNITURE ====================
  const spawnClimbableChair = (idx: number, cx: number, cz: number, rotY: number) => {
    const ch = createChairModel(woodDarkMat, cushionMat);
    ch.position.set(mx(cx), 0, cz);
    ch.rotation.y = mrot(rotY);
    worldGroup.add(ch);
    addBoxCollider(`chair-seat-${idx}`, cx - 2.05, cx + 2.05, 4.35, 4.8, cz - 2.05, cz + 2.05);
    addBoxCollider(`chair-rung-${idx}`, cx - 1.85, cx + 1.85, 1.5, 1.9, cz - 1.85, cz + 1.85);
    addClimbable(
      `climb-chair-${idx}`,
      cx - 2.35,
      cx + 2.35,
      0.1,
      4.95,
      cz - 2.35,
      cz + 2.35,
      0,
      0,
      1,
      'Стул (можно забраться)'
    );
  };

  let tvScreenMat!: THREE.MeshStandardMaterial;

  if (house.wingMode === 0) {
    // --- WING MODE 0: CLASSIC MANOR ---
    // Kitchen Dining Table + 4 Chairs
    [
      [-18.2, -8.2],
      [-3.8, -8.2],
      [-18.2, 2.2],
      [-3.8, 2.2],
    ].forEach(([lx, lz]) => {
      addStaticBox(`ktable-leg-${lx}-${lz}`, lx, 3.55, lz, 0.75, 7.1, 0.75, woodDarkMat, true, true);
    });
    addStaticBox('ktable-top', -11, 7.35, -3, 16.4, 0.55, 12.4, woodMedMat, true, true);
    const runner = new THREE.Mesh(
      new THREE.BoxGeometry(11.0, 0.08, 12.6),
      new THREE.MeshStandardMaterial({ map: textures.tablecloth, roughness: 0.9 })
    );
    runner.position.set(mx(-11), 7.66, -3);
    runner.receiveShadow = true;
    worldGroup.add(runner);
    const clothHang = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 5.4, 0.18),
      new THREE.MeshStandardMaterial({ map: textures.tablecloth, roughness: 0.9 })
    );
    clothHang.position.set(mx(-11), 4.95, 3.35);
    clothHang.castShadow = true;
    worldGroup.add(clothHang);
    addClimbable('climb-tablecloth', -13.2, -8.8, 1.5, 7.7, 2.7, 4.1, 0, 0, 1, 'Скатерть на столе');

    [
      { x: -11, z: 5.5, rot: Math.PI },
      { x: -11, z: -11.5, rot: 0 },
      { x: -21.2, z: -3, rot: Math.PI / 2 },
      { x: -0.8, z: -3, rot: -Math.PI / 2 },
    ].forEach((cfg, idx) => spawnClimbableChair(idx, cfg.x, cfg.z, cfg.rot));

    makeBook('parkour-book-1', 2.4, 0, -2.5, 2.8, 1.6, 2.2, 0);
    makeBook('parkour-book-2', 1.6, 1.6, -2.8, 2.5, 1.6, 2.0, 1);
    addStaticBox('cereal-box-table', -16.2, 9.8, -6.2, 2.6, 4.3, 1.3, cerealMat, true, true);

    // Living Room: Sofa + Coffee Table + Bookshelf + Retro TV + Floor Lamp
    [
      [41.5, -17.2],
      [50.2, -17.2],
      [41.5, 7.2],
      [50.2, 7.2],
    ].forEach(([sx, sz]) => {
      addStaticBox(`sofa-foot-${sx}-${sz}`, sx, 0.65, sz, 0.9, 1.3, 0.9, woodDarkMat, true, true);
    });
    addStaticBox('sofa-base', 46, 2.5, -5, 9.6, 2.4, 25.5, sofaMat, true, true);
    addStaticBox('sofa-back', 49.6, 6.2, -5, 2.4, 5.2, 25.5, sofaMat, true, true);
    addStaticBox('sofa-arm-n', 46, 4.5, -17.0, 9.6, 2.8, 1.8, sofaMat, true, true);
    addStaticBox('sofa-arm-s', 46, 4.5, 7.0, 9.6, 2.8, 1.8, sofaMat, true, true);
    [-12.2, -5, 2.2].forEach((cz, i) => {
      addStaticBox(`sofa-cush-${i}`, 44.8, 4.1, cz, 6.8, 1.0, 6.8, cushionMat, true, true);
    });
    addHideZone('hide-under-sofa', 41.2, 50.8, 0, 1.35, -17.5, 7.5, 'Под диваном');

    [
      [26.8, -9.2],
      [35.2, -9.2],
      [26.8, -0.8],
      [35.2, -0.8],
    ].forEach(([tx, tz]) => {
      addStaticBox(`ctable-leg-${tx}-${tz}`, tx, 1.9, tz, 0.65, 3.8, 0.65, woodDarkMat, true, true);
    });
    addStaticBox('ctable-top', 31, 4.0, -5, 10.2, 0.45, 9.6, woodMedMat, true, true);
    makeBook('ctable-book-step', 24.5, 0, -5, 2.6, 2.0, 2.2, 2);

    addStaticBox('bs-back', 31, 9.5, -29.8, 14, 19, 0.6, woodDarkMat, true, true);
    addStaticBox('bs-left', 24.3, 9.5, -27.2, 0.7, 19, 5.4, woodDarkMat, true, true);
    addStaticBox('bs-right', 37.7, 9.5, -27.2, 0.7, 19, 5.4, woodDarkMat, true, true);
    [0.5, 4.6, 9.0, 13.5, 18.2].forEach((sy, idx) => {
      addStaticBox(`bs-shelf-${idx}`, 31, sy, -27.2, 13.4, 0.5, 5.2, woodMedMat, true, true);
    });
    makeBook('bs-b1', 27, 4.85, -26.6, 3.2, 1.6, 2.6, 0);
    makeBook('bs-b2', 33, 9.25, -26.6, 3.0, 2.2, 2.8, 3);

    // Retro TV Console
    addStaticBox('tv-stand', 48, 2.1, 23.2, 10.0, 4.2, 3.4, woodDarkMat, true, true);
    addStaticBox('tv-cabinet', 48, 6.5, 23.2, 7.6, 4.8, 3.0, woodMedMat, true, true);
    tvScreenMat = new THREE.MeshStandardMaterial({
      color: 0x8adcf2,
      emissive: 0x3aa8d6,
      emissiveIntensity: 1.25,
      roughness: 0.18,
    });
    const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.7, 0.25), tvScreenMat);
    tvScreen.position.set(mx(48), 6.6, 21.65);
    worldGroup.add(tvScreen);
    [-1.2, 1.2].forEach((ax, idx) => {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.8, 6), steelMat);
      ant.position.set(mx(48 + ax * 0.7), 10.1, 23.2);
      ant.rotation.z = idx === 0 ? 0.38 : -0.38;
      worldGroup.add(ant);
    });

    propAnchors.push(
      { x: -12.5, yBottom: 7.65, z: -4.5, elevated: true },
      { x: -7.2, yBottom: 7.65, z: -0.5, elevated: true },
      { x: -14.2, yBottom: 7.65, z: -1.2, elevated: true },
      { x: -8.8, yBottom: 7.65, z: -5.6, elevated: true },
      { x: -10.5, yBottom: 7.65, z: -2.5, elevated: true },
      { x: -5.4, yBottom: 7.65, z: -4.0, elevated: true },
      { x: -6.4, yBottom: 7.65, z: 1.0, elevated: true },
      { x: 29.0, yBottom: 4.23, z: -6.5, elevated: true },
      { x: 33.5, yBottom: 4.23, z: -3.5, elevated: true },
      { x: 31.2, yBottom: 4.23, z: -7.8, elevated: true },
      { x: 29.5, yBottom: 4.85, z: -26.6, elevated: true },
      { x: 30.5, yBottom: 9.25, z: -26.6, elevated: true },
      { x: 45.0, yBottom: 0, z: -4.0, elevated: false },
      { x: 48.0, yBottom: 4.2, z: 22.8, elevated: true }
    );
  } else if (house.wingMode === 1) {
    // --- WING MODE 1: KITCHEN MARBLE ISLAND & SOUTH LOUNGE ---
    // Giant Marble Prep Island at (-11, 0, -5)
    addStaticBox('island-base', -11, 4.1, -5, 13.6, 8.2, 8.4, cabinetMat, true, true);
    addStaticBox('island-top', -11, 8.45, -5, 15.2, 0.55, 9.8, marbleMat, true, true);
    addHideZone('hide-under-island-lip', -18.5, -3.5, 0, 1.2, -9.8, -0.2, 'У кухонного острова');
    makeBook('island-step-1', -2.0, 0, -5.0, 3.0, 2.2, 2.4, 0);
    makeBook('island-step-2', -2.2, 2.2, -5.2, 2.6, 2.2, 2.2, 3);
    addStaticBox('cereal-box-island', -15.5, 10.8, -6.2, 2.6, 4.3, 1.3, cerealMat, true, true);

    // Side Breakfast Table + 2 Climbable Chairs at (-14, 0, 12)
    [
      [-18.2, 8.5],
      [-9.8, 8.5],
      [-18.2, 15.5],
      [-9.8, 15.5],
    ].forEach(([lx, lz]) => {
      addStaticBox(`btable-leg-${lx}-${lz}`, lx, 3.3, lz, 0.65, 6.6, 0.65, woodDarkMat, true, true);
    });
    addStaticBox('btable-top', -14, 6.85, 12, 10.6, 0.5, 9.0, woodMedMat, true, true);
    spawnClimbableChair(0, -14, 4.5, Math.PI);
    spawnClimbableChair(1, -21.2, 12, Math.PI / 2);
    spawnClimbableChair(2, -6.8, 12, -Math.PI / 2);

    // Living Room: Wide Sofa facing North at (36, 0, 11) + Coffee Table at (36, 0, -1)
    [
      [25.2, 7.5],
      [46.8, 7.5],
      [25.2, 14.5],
      [46.8, 14.5],
    ].forEach(([sx, sz]) => {
      addStaticBox(`sofa1-foot-${sx}-${sz}`, sx, 0.65, sz, 0.9, 1.3, 0.9, woodDarkMat, true, true);
    });
    addStaticBox('sofa1-base', 36, 2.5, 11, 23.2, 2.4, 8.8, sofaMat, true, true);
    addStaticBox('sofa1-back', 36, 6.2, 14.4, 23.2, 5.2, 2.2, sofaMat, true, true);
    addStaticBox('sofa1-arm-w', 25.2, 4.5, 11, 1.8, 2.8, 8.8, sofaMat, true, true);
    addStaticBox('sofa1-arm-e', 46.8, 4.5, 11, 1.8, 2.8, 8.8, sofaMat, true, true);
    [29.5, 36, 42.5].forEach((cx, i) => {
      addStaticBox(`sofa1-cush-${i}`, cx, 4.1, 10.0, 6.2, 1.0, 6.2, cushionMat, true, true);
    });
    addHideZone('hide-under-sofa', 24.8, 47.2, 0, 1.35, 6.8, 15.2, 'Под диваном в гостиной');

    [
      [31.5, -4.5],
      [40.5, -4.5],
      [31.5, 2.5],
      [40.5, 2.5],
    ].forEach(([tx, tz]) => {
      addStaticBox(`ctable1-leg-${tx}-${tz}`, tx, 1.9, tz, 0.65, 3.8, 0.65, woodDarkMat, true, true);
    });
    addStaticBox('ctable1-top', 36, 4.0, -1, 11.2, 0.45, 8.6, woodMedMat, true, true);
    makeBook('ctable1-book-step', 29.0, 0, -1, 2.6, 2.0, 2.2, 1);

    // Tall Bookshelf at (31, 0, -27.2) + Retro TV against Living/Bedroom wall (x=54.6, z=-8)
    addStaticBox('bs-back', 31, 9.5, -29.8, 14, 19, 0.6, woodDarkMat, true, true);
    addStaticBox('bs-left', 24.3, 9.5, -27.2, 0.7, 19, 5.4, woodDarkMat, true, true);
    addStaticBox('bs-right', 37.7, 9.5, -27.2, 0.7, 19, 5.4, woodDarkMat, true, true);
    [0.5, 4.6, 9.0, 13.5, 18.2].forEach((sy, idx) => {
      addStaticBox(`bs-shelf-${idx}`, 31, sy, -27.2, 13.4, 0.5, 5.2, woodMedMat, true, true);
    });
    makeBook('bs-b1', 27, 4.85, -26.6, 3.2, 1.6, 2.6, 0);
    makeBook('bs-b2', 33, 9.25, -26.6, 3.0, 2.2, 2.8, 3);

    addStaticBox('tv-stand', 47, 2.1, -26.8, 9.4, 4.2, 3.4, woodDarkMat, true, true);
    addStaticBox('tv-cabinet', 47, 6.5, -26.8, 7.2, 4.8, 2.8, woodMedMat, true, true);
    tvScreenMat = new THREE.MeshStandardMaterial({
      color: 0x90e8d4,
      emissive: 0x3ec2a4,
      emissiveIntensity: 1.25,
      roughness: 0.18,
    });
    const tvScreen1 = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.6, 0.25), tvScreenMat);
    tvScreen1.position.set(mx(47), 6.6, -25.3);
    worldGroup.add(tvScreen1);

    propAnchors.push(
      { x: -12.5, yBottom: 8.75, z: -5.5, elevated: true },
      { x: -7.5, yBottom: 8.75, z: -3.0, elevated: true },
      { x: -9.5, yBottom: 8.75, z: -7.5, elevated: true },
      { x: -14.8, yBottom: 7.1, z: 10.5, elevated: true },
      { x: -11.5, yBottom: 7.1, z: 13.5, elevated: true },
      { x: -16.2, yBottom: 7.1, z: 13.0, elevated: true },
      { x: 34.0, yBottom: 4.23, z: -2.2, elevated: true },
      { x: 38.2, yBottom: 4.23, z: 0.5, elevated: true },
      { x: 35.8, yBottom: 4.23, z: 1.2, elevated: true },
      { x: 29.5, yBottom: 4.85, z: -26.6, elevated: true },
      { x: 30.5, yBottom: 9.25, z: -26.6, elevated: true },
      { x: 36.0, yBottom: 0, z: 10.5, elevated: false },
      { x: 47.0, yBottom: 4.2, z: -26.2, elevated: true }
    );
  } else {
    // --- WING MODE 2: GRAND FIREPLACE ESTATE & PANTRY CRATES ---
    // Shifted Kitchen Table + Pantry Crate Staircase
    [
      [-18.2, -5.2],
      [-5.8, -5.2],
      [-18.2, 4.8],
      [-5.8, 4.8],
    ].forEach(([lx, lz]) => {
      addStaticBox(`ktable2-leg-${lx}-${lz}`, lx, 3.55, lz, 0.75, 7.1, 0.75, woodDarkMat, true, true);
    });
    addStaticBox('ktable2-top', -12, 7.35, -0.2, 15.0, 0.55, 11.8, woodMedMat, true, true);
    const runner2 = new THREE.Mesh(
      new THREE.BoxGeometry(10.0, 0.08, 12.0),
      new THREE.MeshStandardMaterial({ map: textures.tablecloth, roughness: 0.9 })
    );
    runner2.position.set(mx(-12), 7.66, -0.2);
    runner2.receiveShadow = true;
    worldGroup.add(runner2);
    spawnClimbableChair(0, -12, 7.6, Math.PI);
    spawnClimbableChair(1, -12, -8.4, 0);
    spawnClimbableChair(2, -21.8, -0.2, Math.PI / 2);

    // Pantry Parkour Crates at (-29, 0, 14)
    addStaticBox('crate-1', -29, 1.5, 15.5, 4.8, 3.0, 4.8, woodMedMat, true, true);
    addStaticBox('crate-2', -29.5, 4.2, 11.0, 4.2, 2.4, 4.2, woodDarkMat, true, true);
    addStaticBox('cereal-box-crate', -29.5, 7.55, 11.0, 2.6, 4.3, 1.3, cerealMat, true, true);

    // Living Room: Grand Stone Fireplace at (48, 0, -27.2) + Cozy Armchair + Coffee Table + Retro TV
    const brickMat = new THREE.MeshStandardMaterial({ color: 0x7c4638, roughness: 0.92 });
    addStaticBox('fp-base', 48, 0.8, -27.2, 11.0, 1.6, 5.4, brickMat, true, true);
    addStaticBox('fp-pier-l', 44.0, 5.4, -27.5, 2.8, 7.6, 4.8, brickMat, true, true);
    addStaticBox('fp-pier-r', 52.0, 5.4, -27.5, 2.8, 7.6, 4.8, brickMat, true, true);
    addStaticBox('fp-mantel', 48, 9.6, -27.0, 12.2, 1.1, 5.8, woodDarkMat, true, true);
    addStaticBox('fp-chimney', 48, 18.0, -28.0, 7.8, 16.0, 3.8, brickMat, true, true);
    const hearthEmber = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffb84d, emissive: 0xff6218, emissiveIntensity: 1.75 })
    );
    hearthEmber.position.set(mx(48), 2.3, -27.0);
    worldGroup.add(hearthEmber);
    const hearthLight = new THREE.PointLight(0xff8e36, 1.35, 32, 1.4);
    hearthLight.position.set(mx(48), 4.0, -24.5);
    worldGroup.add(hearthLight);

    // Bookshelf at (29, 0, -27.2)
    addStaticBox('bs-back', 29, 9.5, -29.8, 12, 19, 0.6, woodDarkMat, true, true);
    addStaticBox('bs-left', 23.3, 9.5, -27.2, 0.7, 19, 5.4, woodDarkMat, true, true);
    addStaticBox('bs-right', 34.7, 9.5, -27.2, 0.7, 19, 5.4, woodDarkMat, true, true);
    [0.5, 4.6, 9.0, 13.5, 18.2].forEach((sy, idx) => {
      addStaticBox(`bs-shelf-${idx}`, 29, sy, -27.2, 11.4, 0.5, 5.2, woodMedMat, true, true);
    });
    makeBook('bs-b1', 26, 4.85, -26.6, 3.0, 1.6, 2.4, 0);
    makeBook('bs-b2', 31, 9.25, -26.6, 2.8, 2.2, 2.6, 2);

    // Living Room Sofa at (45, 0, -2) + Coffee Table at (31, 0, -2)
    [
      [40.8, -12.5],
      [49.2, -12.5],
      [40.8, 8.5],
      [49.2, 8.5],
    ].forEach(([sx, sz]) => {
      addStaticBox(`sofa2-foot-${sx}-${sz}`, sx, 0.65, sz, 0.9, 1.3, 0.9, woodDarkMat, true, true);
    });
    addStaticBox('sofa2-base', 45, 2.5, -2, 9.2, 2.4, 22.5, sofaMat, true, true);
    addStaticBox('sofa2-back', 48.6, 6.2, -2, 2.2, 5.2, 22.5, sofaMat, true, true);
    addHideZone('hide-under-sofa', 40.4, 49.8, 0, 1.35, -13.0, 9.0, 'Под диваном');

    [
      [27.2, -6.0],
      [35.2, -6.0],
      [27.2, 2.0],
      [35.2, 2.0],
    ].forEach(([tx, tz]) => {
      addStaticBox(`ctable2-leg-${tx}-${tz}`, tx, 1.9, tz, 0.65, 3.8, 0.65, woodDarkMat, true, true);
    });
    addStaticBox('ctable2-top', 31.2, 4.0, -2, 10.0, 0.45, 9.8, woodMedMat, true, true);
    makeBook('ctable2-book-step', 25.0, 0, -2, 2.6, 2.0, 2.2, 3);

    // Retro TV Console against South Living wall
    addStaticBox('tv-stand', 38, 2.1, 23.2, 10.0, 4.2, 3.4, woodDarkMat, true, true);
    addStaticBox('tv-cabinet', 38, 6.5, 23.2, 7.6, 4.8, 3.0, woodMedMat, true, true);
    tvScreenMat = new THREE.MeshStandardMaterial({
      color: 0xffc78a,
      emissive: 0xe68432,
      emissiveIntensity: 1.25,
      roughness: 0.18,
    });
    const tvScreen2 = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.7, 0.25), tvScreenMat);
    tvScreen2.position.set(mx(38), 6.6, 21.65);
    worldGroup.add(tvScreen2);

    propAnchors.push(
      { x: -14.5, yBottom: 7.65, z: -2.0, elevated: true },
      { x: -9.5, yBottom: 7.65, z: 2.0, elevated: true },
      { x: -12.0, yBottom: 7.65, z: -3.2, elevated: true },
      { x: -8.5, yBottom: 7.65, z: -2.5, elevated: true },
      { x: -29.0, yBottom: 3.0, z: 15.5, elevated: true },
      { x: 29.0, yBottom: 4.23, z: -3.5, elevated: true },
      { x: 33.4, yBottom: 4.23, z: 0.2, elevated: true },
      { x: 31.0, yBottom: 4.23, z: -4.8, elevated: true },
      { x: 48.0, yBottom: 10.15, z: -27.0, elevated: true },
      { x: 27.5, yBottom: 4.85, z: -26.6, elevated: true },
      { x: 29.5, yBottom: 9.25, z: -26.6, elevated: true },
      { x: 44.0, yBottom: 0, z: -2.0, elevated: false },
      { x: 38.0, yBottom: 4.2, z: 22.8, elevated: true }
    );
  }

  // Ivy Vine Climbable in Living Room (present in all layouts near West Living wall)
  const potMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.25, 2.8, 14),
    new THREE.MeshStandardMaterial({ color: 0x995035, roughness: 0.8 })
  );
  potMesh.position.set(mx(20.5), 1.4, -27.0);
  potMesh.castShadow = true;
  worldGroup.add(potMesh);
  addBoxCollider('plant-pot', 18.8, 22.2, 0, 2.8, -28.7, -25.3);
  const vineCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(mx(20.5), 2.6, -27.0),
    new THREE.Vector3(mx(21.2), 6.0, -26.2),
    new THREE.Vector3(mx(22.5), 10.2, -25.8),
    new THREE.Vector3(mx(23.5), 14.0, -26.2),
  ]);
  const vineStem = new THREE.Mesh(new THREE.TubeGeometry(vineCurve, 20, 0.22, 8, false), vineMat);
  vineStem.castShadow = true;
  worldGroup.add(vineStem);
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const pt = vineCurve.getPoint(t);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), vineMat);
    leaf.scale.set(1.2, 0.25, 0.8);
    leaf.position.set(pt.x + (i % 2 === 0 ? 0.45 : -0.45), pt.y, pt.z + 0.3);
    leaf.rotation.y = i * 0.8;
    worldGroup.add(leaf);
  }
  addClimbable('climb-ivy-vine', 19.4, 23.8, 1.8, 14.5, -28.2, -24.8, 0, 0, 1, 'Стебель плюща');

  // ==================== GIANT STUDY / OFFICE ====================
  addStaticBox('study-desk-ped-l', 28.2, 3.6, -50, 2.4, 7.2, 6.8, woodDarkMat, true, true);
  addStaticBox('study-desk-ped-r', 39.8, 3.6, -50, 2.4, 7.2, 6.8, woodDarkMat, true, true);
  addStaticBox('study-desk-top', 34, 7.5, -50, 15.2, 0.6, 7.6, woodMedMat, true, true);
  addHideZone('hide-under-desk', 29.4, 38.6, 0, 2.2, -53.5, -46.5, 'Под письменным столом');
  spawnClimbableChair(10, 34, -43.5, Math.PI);

  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.4, 12), darkMetalMat);
  lampBase.position.set(mx(28.5), 8.0, -51.5);
  const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.8, 8), darkMetalMat);
  lampStem.position.set(mx(28.5), 9.4, -51.5);
  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(1.3, 1.4, 14),
    new THREE.MeshStandardMaterial({ color: 0x3c754d, roughness: 0.5 })
  );
  lampShade.position.set(mx(28.5), 11.0, -51.5);
  worldGroup.add(lampBase, lampStem, lampShade);
  const studyLight = new THREE.PointLight(0xffd699, 1.2, 42, 1.4);
  studyLight.position.set(mx(34), 15, -46);
  worldGroup.add(studyLight);

  makeBook('study-book-1', 21.5, 0, -47, 3.2, 1.8, 2.4, 2);
  makeBook('study-book-2', 22.0, 1.8, -47.2, 2.8, 1.8, 2.2, 0);

  propAnchors.push(
    { x: 34.5, yBottom: 7.8, z: -50.2, elevated: true },
    { x: 38.2, yBottom: 7.8, z: -48.8, elevated: true },
    { x: 31.0, yBottom: 7.8, z: -48.5, elevated: true },
    { x: 23.0, yBottom: 0, z: -42.0, elevated: false }
  );

  // ==================== GIANT BEDROOM ====================
  [
    [68.8, -44.8],
    [85.2, -44.8],
    [68.8, -23.2],
    [85.2, -23.2],
  ].forEach(([bx, bz]) => {
    addStaticBox(`bed-leg-${bx}-${bz}`, bx, 0.7, bz, 1.1, 1.4, 1.1, woodDarkMat, true, true);
  });
  addStaticBox('bed-frame', 77, 2.4, -34, 18.2, 2.0, 23.6, woodMedMat, true, true);
  const quiltMat = new THREE.MeshStandardMaterial({ color: pal.quiltTint, map: textures.bedQuilt, roughness: 0.9 });
  addStaticBox('bed-mattress', 77, 4.1, -34, 17.4, 1.6, 22.6, quiltMat, true, true);
  addStaticBox('bed-headboard', 77, 6.2, -45.5, 18.4, 7.6, 1.1, woodDarkMat, true, true);
  [-4.2, 4.2].forEach((px, i) => {
    addStaticBox(
      `bed-pillow-${i}`,
      77 + px,
      5.35,
      -42.0,
      6.4,
      1.2,
      4.2,
      new THREE.MeshStandardMaterial({ color: 0xe8dfd0, roughness: 0.92 }),
      true,
      true
    );
  });
  addHideZone('hide-under-bed', 68.0, 86.0, 0, 1.45, -45.5, -22.5, 'Под гигантской кроватью');

  const bedSheet = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.4, 4.6), quiltMat);
  bedSheet.position.set(mx(67.75), 2.4, -33.0);
  bedSheet.castShadow = true;
  worldGroup.add(bedSheet);
  addClimbable('climb-bed-sheet', 67.0, 68.4, 0.2, 5.0, -35.4, -30.6, -1, 0, 0, 'Одеяло с кровати');

  addStaticBox('nightstand', 86.5, 2.4, -10.5, 6.2, 4.8, 6.2, woodDarkMat, true, true);
  // Alarm clock & bedside lamp on nightstand + Bedroom Dresser & Mirror (X: 64, Z: -53)
  addStaticBox('bed-clock', 86.2, 5.4, -10.5, 1.4, 1.2, 0.8, darkMetalMat, true, true);
  addStaticBox('bedroom-dresser', 64, 4.2, -53, 8.2, 8.4, 4.4, woodMedMat, true, true);
  addStaticBox('bedroom-mirror', 64, 11.4, -54.8, 5.4, 5.8, 0.3, darkMetalMat, false, true, false);
  const bedLight = new THREE.PointLight(0xffcf90, 1.25, 45, 1.4);
  bedLight.position.set(mx(78), 16, -20);
  worldGroup.add(bedLight);

  [
    [82.5, 9.2],
    [89.5, 9.2],
    [82.5, 20.8],
    [89.5, 20.8],
  ].forEach(([wx, wz]) => {
    addStaticBox(`wardrobe-leg-${wx}-${wz}`, wx, 0.7, wz, 0.9, 1.4, 0.9, woodDarkMat, true, true);
  });
  addStaticBox('wardrobe-body', 86, 10.4, 15, 8.4, 18.0, 13.0, woodMedMat, true, true);
  addHideZone('hide-under-wardrobe', 81.8, 90.2, 0, 1.45, 8.5, 21.5, 'Под шкафом в спальне');

  [-15.5, 3.5].forEach((cz, idx) => {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.45, 17.5, 3.4), curtainMat);
    curtain.position.set(mx(71 + idx * 10), 9.5, -55.1);
    curtain.rotation.y = Math.PI / 2;
    curtain.castShadow = true;
    worldGroup.add(curtain);
    addClimbable(`climb-curtain-${idx}`, 69.2 + idx * 10, 72.8 + idx * 10, 0.5, 17.8, -56.2, -54.0, 0, 0, 1, 'Штора у окна спальни');
  });

  propAnchors.push(
    { x: 86.2, yBottom: 4.8, z: -10.5, elevated: true },
    { x: 64.0, yBottom: 8.4, z: -53.0, elevated: true },
    { x: 76.0, yBottom: 0, z: -34.0, elevated: false },
    { x: 75.5, yBottom: 4.9, z: -32.0, elevated: true },
    { x: 85.0, yBottom: 0, z: 15.0, elevated: false },
    { x: 78.8, yBottom: 4.9, z: -29.0, elevated: true }
  );

  // Wall Artworks & Standing Floor Lamp
  const paintingFrameMat = new THREE.MeshStandardMaterial({ color: 0xd1a33f, metalness: 0.72, roughness: 0.3 });
  const paintingArt1 = new THREE.MeshStandardMaterial({ map: textures.paintingLandscape, roughness: 0.72 });
  const paintingArt2 = new THREE.MeshStandardMaterial({ map: textures.paintingStillLife, roughness: 0.72 });
  addStaticBox('art-frame-1', 57.3, 12.5, -24, 0.3, 6.2, 8.6, paintingFrameMat, false, true, false);
  addStaticBox('art-canvas-1', 57.15, 12.5, -24, 0.1, 5.2, 7.6, paintingArt1, false, true, false);
  addStaticBox('art-frame-2', 14.68, 12.5, -45, 0.3, 6.2, 8.6, paintingFrameMat, false, true, false);
  addStaticBox('art-canvas-2', 14.84, 12.5, -45, 0.1, 5.2, 7.6, paintingArt2, false, true, false);

  addStaticBox('flamp-base', 54.6, 0.25, 19.2, 2.0, 0.5, 2.0, darkMetalMat, true, true);
  addStaticBox('flamp-pole', 54.6, 7.0, 19.2, 0.35, 13.5, 0.35, darkMetalMat, true, true);
  const flampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 2.1, 2.6, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffebc2,
      emissive: 0xffb347,
      emissiveIntensity: 1.3,
      roughness: 0.4,
    })
  );
  flampShade.position.set(mx(54.6), 14.4, 19.2);
  worldGroup.add(flampShade);
  const flampGlow = new THREE.PointLight(0xffcb82, 0.8, 28, 1.4);
  flampGlow.position.set(mx(54.6), 13.2, 19.2);
  worldGroup.add(flampGlow);

  // ==================== HALLWAY BENCH ====================
  [
    [24.8, 33.6],
    [37.2, 33.6],
    [24.8, 38.4],
    [37.2, 38.4],
  ].forEach(([bx, bz]) => {
    addStaticBox(`bench-leg-${bx}-${bz}`, bx, 0.7, bz, 0.7, 1.4, 0.7, woodDarkMat, true, true);
  });
  addStaticBox('bench-top', 31, 3.0, 36, 13.6, 3.2, 5.6, woodMedMat, true, true);
  addHideZone('hide-hallway-bench', 24.2, 37.8, 0, 1.4, 33.2, 38.8, 'Под скамьёй в прихожей');

  propAnchors.push(
    { x: 30.0, yBottom: 0, z: 36.0, elevated: false },
    { x: 28.0, yBottom: 4.6, z: 36.0, elevated: true },
    { x: 34.0, yBottom: 4.6, z: 36.0, elevated: true },
    // Garage loot anchors (batteries, scrap, coins)
    { x: 114.2, yBottom: 2.5, z: 11.0, elevated: true },
    { x: 118.4, yBottom: 2.5, z: 10.2, elevated: true },
    { x: 97.5, yBottom: 4.2, z: 11.0, elevated: true },
    { x: 103.5, yBottom: 0, z: 18.0, elevated: false },
    { x: 118.0, yBottom: 0, z: 31.0, elevated: false }
  );

  // ==================== CHANDELIER ====================
  const chandGroup = new THREE.Group();
  chandGroup.position.set(mx(10), 23.2, -2);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.5, 10), darkMetalMat);
  rod.position.y = 1.2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.2, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xc2983e, metalness: 0.85, roughness: 0.3 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.4;
  chandGroup.add(rod, ring);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe8bd,
    emissive: 0xffb854,
    emissiveIntensity: 1.55,
    roughness: 0.18,
  });
  let chandelierGlow!: THREE.Mesh;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 10), bulbMat);
    bulb.position.set(Math.cos(a) * 2.6, -1.0, Math.sin(a) * 2.6);
    chandGroup.add(bulb);
    if (i === 0) chandelierGlow = bulb;
  }
  worldGroup.add(chandGroup);

  // ==================== SEEDED INTERACTIVE PROPS (ALL 17 CATEGORIES!) ====================
  const markerGeo = new THREE.OctahedronGeometry(0.22, 0);
  const markerMat = new THREE.MeshStandardMaterial({
    color: 0xffe178,
    emissive: 0xf5ab29,
    emissiveIntensity: 1.45,
    roughness: 0.2,
  });

  let propIdx = 0;
  const spawnProp = (category: ItemCategory, x: number, yBottom: number, z: number) => {
    const meta = PROP_META[category];
    const name = meta.names[propIdx % meta.names.length];
    const built = createPropModel(category, textures);
    const wx = mx(x);
    built.group.position.set(wx, yBottom + built.halfHeight, z);
    built.group.rotation.y = (propIdx * 1.17) % (Math.PI * 2);
    worldGroup.add(built.group);

    const questMarker = new THREE.Mesh(markerGeo, markerMat);
    questMarker.position.set(wx, yBottom + built.halfHeight * 2 + 0.75, z);
    questMarker.visible = false;
    worldGroup.add(questMarker);

    props.push({
      id: `prop-${propIdx++}`,
      name,
      category,
      mesh: built.group,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      radius: built.radius,
      halfHeight: built.halfHeight,
      weight: built.weight,
      valueShinies: meta.valueShinies,
      valueScrap: meta.valueScrap,
      grabbable: true,
      breakable: meta.breakable ?? false,
      broken: false,
      isTrashBin: meta.isTrashBin ?? false,
      tipped: false,
      collected: false,
      isHeld: false,
      spawnPos: built.group.position.clone(),
      questMarker,
    });
  };

  // Shuffle anchors deterministically per house
  const shuffledAnchors = [...propAnchors];
  for (let i = shuffledAnchors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledAnchors[i], shuffledAnchors[j]] = [shuffledAnchors[j], shuffledAnchors[i]];
  }

  // Build guaranteed quest items + house-themed items + full variety
  const spawnQueue: ItemCategory[] = [];
  for (const q of activeQuests) {
    if (q.targetCategory === 'trashbin') continue;
    const minNeeded = Math.max(q.requiredCount + 1, 2);
    for (let k = 0; k < minNeeded; k++) {
      spawnQueue.push(q.targetCategory);
    }
  }
  for (const pref of house.preferredCategories) {
    spawnQueue.push(pref, pref);
  }
  const desiredCount = Math.min(shuffledAnchors.length, 26 + house.extraPropCount);
  while (spawnQueue.length < desiredCount) {
    const cat = ALL_LOOT_CATEGORIES[Math.floor(rng() * ALL_LOOT_CATEGORIES.length)];
    spawnQueue.push(cat);
  }

  // Place trashbin on floor (always 1 guaranteed in a wide floor spot!)
  const trashSpotX = house.wingMode === 1 ? 10.5 : house.wingMode === 2 ? 8.5 : 10.5;
  const trashSpotZ = house.wingMode === 1 ? -10.5 : 8.5;
  spawnProp('trashbin', trashSpotX, 0, trashSpotZ);

  // Place queued props across anchors with subtle jitter
  for (let i = 0; i < Math.min(spawnQueue.length, shuffledAnchors.length); i++) {
    const a = shuffledAnchors[i];
    const jx = (rng() - 0.5) * 0.9;
    const jz = (rng() - 0.5) * 0.9;
    spawnProp(spawnQueue[i], a.x + jx, a.yBottom, a.z + jz);
  }

  // ==================== INSECTS ====================
  const insectAnchorPool: Array<{ kind: 'cockroach' | 'spider'; x: number; y: number; z: number }> = [
    { kind: 'cockroach', x: -18, y: 0, z: 12 },
    { kind: 'cockroach', x: -25, y: 0, z: -20 },
    { kind: 'cockroach', x: 6, y: 0, z: -8 },
    { kind: 'spider', x: 26, y: 0, z: -18 },
    { kind: 'spider', x: 38, y: 0, z: 14 },
    { kind: 'cockroach', x: -12, y: house.wingMode === 1 ? 8.75 : 7.65, z: -3.0 },
    { kind: 'spider', x: 42, y: 0, z: -40 },
    { kind: 'cockroach', x: 74, y: 0, z: -6 },
    { kind: 'spider', x: 66, y: 0, z: -28 },
    { kind: 'cockroach', x: 24, y: 0, z: 32 },
    { kind: 'spider', x: -6, y: 0, z: 18 },
    { kind: 'cockroach', x: 80, y: 0, z: 18 },
  ];
  for (let i = insectAnchorPool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [insectAnchorPool[i], insectAnchorPool[j]] = [insectAnchorPool[j], insectAnchorPool[i]];
  }
  const activeInsects = insectAnchorPool.slice(0, Math.min(house.insectCount, insectAnchorPool.length));
  activeInsects.forEach((sp, i) => {
    const built = createInsectModel(sp.kind, textures);
    const wx = mx(sp.x);
    built.group.position.set(wx, sp.y, sp.z);
    worldGroup.add(built.group);
    insects.push({
      id: `insect-${i}`,
      kind: sp.kind,
      mesh: built.group,
      bodyGroup: built.bodyGroup,
      legs: built.legs,
      antennae: built.antennae,
      position: new THREE.Vector3(wx, sp.y, sp.z),
      velocity: new THREE.Vector3(),
      yaw: rng() * Math.PI * 2,
      hp: sp.kind === 'spider' ? 3 : 2,
      maxHp: sp.kind === 'spider' ? 3 : 2,
      homePos: new THREE.Vector3(wx, sp.y, sp.z),
      patrolTarget: new THREE.Vector3(wx + (rng() - 0.5) * 8, sp.y, sp.z + (rng() - 0.5) * 8),
      attackCooldown: 0,
      hitFlash: 0,
      dead: false,
      deathTimer: 0,
    });
  });

  // ==================== OBSTACLE-FREE NAVIGATION & PATROL ====================
  const navNodes: NavNode[] = [
    { id: 'KITCHEN_N', pos: new THREE.Vector3(mx(-6), 0, -16) },
    { id: 'KITCHEN_NE', pos: new THREE.Vector3(mx(6), 0, -16) },
    { id: 'KITCHEN_E', pos: new THREE.Vector3(mx(6), 0, 2) },
    { id: 'KITCHEN_S', pos: new THREE.Vector3(mx(6), 0, 18) },
    { id: 'DOOR_KL', pos: new THREE.Vector3(mx(14), 0, 2) },
    { id: 'LIVING_W', pos: new THREE.Vector3(mx(20.5), 0, 2) },
    { id: 'LIVING_NW', pos: new THREE.Vector3(mx(20.5), 0, -20) },
    { id: 'LIVING_SW', pos: new THREE.Vector3(mx(20.5), 0, 19) },
    { id: 'LIVING_N', pos: new THREE.Vector3(mx(41), 0, -21) },
    { id: 'LIVING_NE', pos: new THREE.Vector3(mx(54), 0, -21) },
    { id: 'LIVING_E', pos: new THREE.Vector3(mx(54), 0, -2) },
    { id: 'DOOR_LS', pos: new THREE.Vector3(mx(41), 0, -32) },
    { id: 'STUDY_C', pos: new THREE.Vector3(mx(34), 0, -39) },
    { id: 'DOOR_LB', pos: new THREE.Vector3(mx(58), 0, -2) },
    { id: 'BEDROOM_N', pos: new THREE.Vector3(mx(63), 0, -34) },
    { id: 'BEDROOM_W', pos: new THREE.Vector3(mx(63), 0, -2) },
    { id: 'BEDROOM_E', pos: new THREE.Vector3(mx(88), 0, -21) },
    { id: 'DOOR_BATH', pos: new THREE.Vector3(mx(92.5), 0, -21) },
    { id: 'BATHROOM_C', pos: new THREE.Vector3(mx(108), 0, -13) },
    { id: 'BEDROOM_S', pos: new THREE.Vector3(mx(74), 0, 14) },
    { id: 'DOOR_BH', pos: new THREE.Vector3(mx(74), 0, 26) },
    { id: 'HALL_E', pos: new THREE.Vector3(mx(74), 0, 33) },
    { id: 'HALL_W', pos: new THREE.Vector3(mx(6), 0, 29.8) },
    { id: 'DOOR_LH', pos: new THREE.Vector3(mx(20.5), 0, 29.8) },
    { id: 'HALL_C', pos: new THREE.Vector3(mx(44), 0, 29.8) },
    { id: 'HALL_DOOR', pos: new THREE.Vector3(mx(53), 0, 37.5) },
    { id: 'PORCH', pos: new THREE.Vector3(mx(53), 0, 44.2) },
  ];

  const navEdges: Record<string, string[]> = {
    KITCHEN_N: ['KITCHEN_NE'],
    KITCHEN_NE: ['KITCHEN_N', 'KITCHEN_E'],
    KITCHEN_E: ['KITCHEN_NE', 'KITCHEN_S', 'DOOR_KL'],
    KITCHEN_S: ['KITCHEN_E', 'HALL_W'],
    DOOR_KL: ['KITCHEN_E', 'LIVING_W'],
    LIVING_W: ['DOOR_KL', 'LIVING_NW', 'LIVING_SW'],
    LIVING_NW: ['LIVING_W', 'LIVING_N'],
    LIVING_SW: ['LIVING_W', 'DOOR_LH'],
    LIVING_N: ['LIVING_NW', 'DOOR_LS', 'LIVING_NE'],
    LIVING_NE: ['LIVING_N', 'LIVING_E'],
    LIVING_E: ['LIVING_NE', 'DOOR_LB'],
    DOOR_LS: ['LIVING_N', 'STUDY_C'],
    STUDY_C: ['DOOR_LS'],
    DOOR_LB: ['LIVING_E', 'BEDROOM_W'],
    BEDROOM_N: ['BEDROOM_W', 'BEDROOM_E'],
    BEDROOM_W: ['DOOR_LB', 'BEDROOM_N', 'BEDROOM_S', 'BEDROOM_E'],
    BEDROOM_E: ['BEDROOM_N', 'BEDROOM_W', 'DOOR_BATH'],
    DOOR_BATH: ['BEDROOM_E', 'BATHROOM_C'],
    BATHROOM_C: ['DOOR_BATH'],
    BEDROOM_S: ['BEDROOM_W', 'DOOR_BH'],
    DOOR_BH: ['BEDROOM_S', 'HALL_E'],
    HALL_E: ['DOOR_BH', 'HALL_DOOR'],
    HALL_W: ['KITCHEN_S', 'DOOR_LH'],
    DOOR_LH: ['LIVING_SW', 'HALL_W', 'HALL_C'],
    HALL_C: ['DOOR_LH', 'HALL_DOOR'],
    HALL_DOOR: ['HALL_C', 'HALL_E', 'PORCH'],
    PORCH: ['HALL_DOOR'],
  };

  const baseWaypoints = [
    new THREE.Vector3(mx(5), 0, -16),
    new THREE.Vector3(mx(-21), 0, -17),
    new THREE.Vector3(mx(5), 0, -15),
    new THREE.Vector3(mx(5), 0, 12),
    new THREE.Vector3(mx(-22), 0, 18),
    new THREE.Vector3(mx(5), 0, 18),
    new THREE.Vector3(mx(21), 0, 16),
    new THREE.Vector3(mx(20), 0, -20),
    new THREE.Vector3(mx(34), 0, -37),
    new THREE.Vector3(mx(48), 0, -38),
    new THREE.Vector3(mx(65), 0, -43),
    new THREE.Vector3(mx(64), 0, -12),
    new THREE.Vector3(mx(106), 0, -14),
    new THREE.Vector3(mx(70), 0, 18),
    new THREE.Vector3(mx(53), 0, 32),
    new THREE.Vector3(mx(20), 0, 30),
  ];
  const wpShift = house.id % baseWaypoints.length;
  const patrolWaypoints = [
    ...baseWaypoints.slice(wpShift),
    ...baseWaypoints.slice(0, wpShift),
  ];

  // ==================== TREE WITH EYES HUB CLEARING ("ДЕРЕВО С ГЛАЗАМИ", Z: 106..162) ====================
  const hubGrass = new THREE.Mesh(
    new THREE.PlaneGeometry(92, 68),
    new THREE.MeshStandardMaterial({
      color: mood.id === 'winter' ? 0xd9e8ed : mood.id === 'autumn' ? 0xd6c28f : 0xffffff,
      map: textures.grassLawn,
      roughness: 0.95,
    })
  );
  hubGrass.rotation.x = -Math.PI / 2;
  hubGrass.position.set(mx(28), -0.02, 134);
  hubGrass.receiveShadow = true;
  worldGroup.add(hubGrass);
  addBoxCollider('hub-floor', -22, 78, -2, 0, 102, 172, true);

  const hubCobble = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 22),
    new THREE.MeshStandardMaterial({
      map: textures.cobblePath,
      normalMap: textures.cobblePathNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.86,
    })
  );
  hubCobble.rotation.x = -Math.PI / 2;
  hubCobble.position.set(mx(28), 0.015, 143);
  hubCobble.receiveShadow = true;
  worldGroup.add(hubCobble);

  const treeWithEyesRig = createTreeWithEyesModel(textures);
  treeWithEyesRig.group.position.set(mx(28), 0, 128);
  worldGroup.add(treeWithEyesRig.group);

  // Tree trunk hollow colliders leaving front archway (X: 25..31, Z: 132..135) wide open!
  addBoxCollider('treehub-back', 20, 36, 0, 22, 120.4, 122.6);
  addBoxCollider('treehub-w', 19.7, 21.9, 0, 22, 120.8, 134.2);
  addBoxCollider('treehub-e', 34.1, 36.3, 0, 22, 120.8, 134.2);
  addBoxCollider('treehub-front-w', 20.8, 25.0, 0, 22, 132.4, 134.6);
  addBoxCollider('treehub-front-e', 31.0, 35.2, 0, 22, 132.4, 134.6);
  addBoxCollider('treehub-pedestal', 27.0, 29.0, 0, 2.5, 124.8, 126.8);

  // Scenic ring of forest trees & glowing mushrooms around Tree with Eyes clearing
  [
    [4, 122, 1.1],
    [52, 122, 1.15],
    [-4, 142, 1.05],
    [60, 142, 1.08],
    [8, 158, 0.95],
    [48, 158, 1.0],
  ].forEach(([tx, tz, sc]) => {
    spawnCartoonTree(tx, tz, sc);
  });
  const hubShroomMat = new THREE.MeshStandardMaterial({
    color: 0x7df2d6,
    emissive: 0x2ec4a6,
    emissiveIntensity: 1.5,
  });
  [
    [22.5, 137],
    [33.5, 137],
    [20.5, 146],
    [35.5, 146],
  ].forEach(([sx, sz]) => {
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.55, 8), hubShroomMat);
    sh.position.set(mx(sx), 0.55, sz);
    worldGroup.add(sh);
  });

  const homeMarker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28, 0),
    new THREE.MeshStandardMaterial({ color: 0x7effc7, emissive: 0x2fd48c, emissiveIntensity: 1.5 })
  );
  homeMarker.position.set(mx(-17), 3.05, 29.4);
  worldGroup.add(homeMarker);

  applyStylizedShaderToObject(worldGroup, {
    rimStrength: 0.30,
    celBoost: 0.44,
    shadowTintStrength: 0.38,
  });

  const bx1 = mx(-24.5);
  const bx2 = mx(-9.5);
  const burrowBounds = {
    minX: Math.min(bx1, bx2),
    maxX: Math.max(bx1, bx2),
    minZ: 30,
    maxZ: 42,
  };

  const gx1 = mx(92.5);
  const gx2 = mx(124.5);
  const garageBounds = {
    minX: Math.min(gx1, gx2),
    maxX: Math.max(gx1, gx2),
    minZ: 6,
    maxZ: 42.5,
  };

  const bathBounds = {
    minX: Math.min(gx1, gx2),
    maxX: Math.max(gx1, gx2),
    minZ: -32,
    maxZ: 6,
  };

  const sx1 = mx(-28);
  const sx2 = mx(-10);
  const shedBounds = {
    minX: Math.min(sx1, sx2),
    maxX: Math.max(sx1, sx2),
    minZ: 48,
    maxZ: 66,
  };

  const hx1 = mx(22);
  const hx2 = mx(34);
  const hubInteriorBounds = {
    minX: Math.min(hx1, hx2),
    maxX: Math.max(hx1, hx2),
    minZ: 121.5,
    maxZ: 132.5,
  };

  return {
    worldGroup,
    house,
    colliders,
    climbables,
    hideZones,
    props,
    insects,
    patrolWaypoints,
    navNodes,
    navEdges,
    highGnomePos,
    highGnomeRig,
    companionRigs,
    workbenchPos,
    stashCenter,
    stashRadius: 2.3,
    burrowBounds,
    garageCopterPos: new THREE.Vector3(mx(108.5), 0, 26),
    droneDockPos,
    droneDockMesh: dockDrone.group,
    garageBounds,
    bathroomBounds: bathBounds,
    shedBounds,
    carSpawnPos: new THREE.Vector3(mx(108.5), 0, 54),
    dogSpawnPos: new THREE.Vector3(mx(23), 0, 56),
    catSpawnPos: new THREE.Vector3(mx(32), 0, 4),
    doghousePos,
    hubSpawnPos: new THREE.Vector3(mx(28), 0, 150),
    houseArrivalPos: new THREE.Vector3(mx(44), 0, 62),
    playButtonPos: new THREE.Vector3(mx(28), 2.38, 125.8),
    hubInteriorBounds,
    treeWithEyesRig,
    spawnPos: new THREE.Vector3(mx(-17), 0, 36.8),
    frontDoorPos: new THREE.Vector3(mx(53), 0, 41.5),
    porchTargetPos: new THREE.Vector3(mx(53), 0, 44.5),
    streetDropPos: new THREE.Vector3(mx(53), 1.5, 57),
    titleCameraCenter: new THREE.Vector3(mx(23), 7.6, -5),
    isKitchenAt: (x: number, z: number) => z < 26 && (house.mirrorX ? x > 42 : x < 14),
    chandelierGlow,
    burrowLight,
    burrowFlame,
    cauldronBubbles,
    tvScreenMat,
    animatedUniforms,
  };
}
