import type { HouseSummary, ItemCategory } from '../types/game';

export const HOUSES_COUNT = 100;

export type WingMode = 0 | 1 | 2;

export type HouseMoodId =
  | 'morning'
  | 'golden'
  | 'sunset'
  | 'twilight'
  | 'mint'
  | 'crimson'
  | 'autumn'
  | 'winter'
  | 'lavender'
  | 'emerald';

export interface HouseMoodConfig {
  id: HouseMoodId;
  label: string;
  skyZenith: [number, number, number];
  skyMid: [number, number, number];
  skyHorizon: [number, number, number];
  skyGround: [number, number, number];
  sceneBg: number;
  fogColor: number;
  fogDensity: number;
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  chandelierColor: number;
  chandelierIntensity: number;
  grassTuftColor: number;
  grassHueBase: number;
  leafLight: number;
  leafMid: number;
  leafDark: number;
}

export interface HousePalette {
  wallKitchen: number;
  wallLivingTint: number;
  wallBedroom: number;
  baseboard: number;
  woodDark: number;
  woodMed: number;
  cabinet: number;
  sofa: number;
  cushion: number;
  quiltTint: number;
  curtainTint: number;
  rugTint: number;
  fence: number;
  mailbox: number;
  humanShirt: number;
  humanCardigan: number;
}

export interface HouseBlueprint {
  id: number; // 1..100
  seed: number;
  name: string;
  district: string;
  themeLabel: string;
  layoutId: 0 | 1 | 2 | 3 | 4 | 5;
  layoutName: string;
  mirrorX: boolean;
  wingMode: WingMode;
  mood: HouseMoodConfig;
  palette: HousePalette;
  insectCount: number;
  extraPropCount: number;
  treeSeed: number;
  preferredCategories: ItemCategory[];
  summary: HouseSummary;
}

export function createSeededRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DISTRICTS = [
  'Солнечный Холм',
  'Яблоневый Переулок',
  'Старый Посад',
  'Кленовая Аллея',
  'Тихий Пруд',
  'Медовая Роща',
  'Брусничный Квартал',
  'Каменная Набережная',
  'Сосновый Бор',
  'Золотая Вершина',
];

const HOUSE_ARCHETYPES: Array<{
  baseName: string;
  themeLabel: string;
  preferred: ItemCategory[];
}> = [
  { baseName: 'Особняк Дядюшки Гроха', themeLabel: 'Купеческая усадьба', preferred: ['coin', 'cheese', 'mug'] },
  { baseName: 'Коттедж Пекаря Мартына', themeLabel: 'Хлебная и сыроварня', preferred: ['cheese', 'apple', 'plate'] },
  { baseName: 'Мастерская Часовщика', themeLabel: 'Латунь и шестерни', preferred: ['watch', 'scrap', 'battery'] },
  { baseName: 'Вилла Коллекционера', themeLabel: 'Фарфор и драгоценности', preferred: ['vase', 'ring', 'plate'] },
  { baseName: 'Домик Старого Капитана', themeLabel: 'Тайники и ключи', preferred: ['key', 'candle', 'coin'] },
  { baseName: 'Усадьба Профессора', themeLabel: 'Кабинет и редкие книги', preferred: ['candle', 'watch', 'remote'] },
  { baseName: 'Дача Садовника', themeLabel: 'Фрукты и уютный двор', preferred: ['apple', 'vase', 'mug'] },
  { baseName: 'Таунхаус Телемастера', themeLabel: 'Техника и провода', preferred: ['remote', 'battery', 'scrap'] },
  { baseName: 'Резиденция Ювелира', themeLabel: 'Золото и кольца', preferred: ['ring', 'coin', 'watch'] },
  { baseName: 'Хоромы Бургомистра', themeLabel: 'Парадные покои', preferred: ['ring', 'key', 'vase'] },
];

const HOUSE_ADJECTIVES = [
  'Уютный',
  'Мятный',
  'Янтарный',
  'Дубовый',
  'Закатный',
  'Лавандовый',
  'Северный',
  'Багряный',
  'Изумрудный',
  'Серебряный',
];

const MOOD_LIST: HouseMoodConfig[] = [
  {
    id: 'golden',
    label: 'Золотой полдень',
    skyZenith: [0.16, 0.44, 0.80],
    skyMid: [0.38, 0.70, 0.95],
    skyHorizon: [0.92, 0.82, 0.66],
    skyGround: [0.42, 0.50, 0.40],
    sceneBg: 0x6daae0,
    fogColor: 0x28212e,
    fogDensity: 0.002,
    sunDir: [112, 34, 8],
    sunColor: 0xffe1b0,
    sunIntensity: 1.35,
    hemiSky: 0x98ccff,
    hemiGround: 0x6b4730,
    hemiIntensity: 0.62,
    chandelierColor: 0xffcf94,
    chandelierIntensity: 1.4,
    grassTuftColor: 0x67b048,
    grassHueBase: 0.27,
    leafLight: 0x5ca846,
    leafMid: 0x458b37,
    leafDark: 0x336d2d,
  },
  {
    id: 'morning',
    label: 'Свежее утро',
    skyZenith: [0.22, 0.56, 0.88],
    skyMid: [0.55, 0.80, 0.97],
    skyHorizon: [0.98, 0.88, 0.78],
    skyGround: [0.48, 0.58, 0.48],
    sceneBg: 0x8cc8f2,
    fogColor: 0x383a4a,
    fogDensity: 0.0018,
    sunDir: [96, 46, 38],
    sunColor: 0xfff0d4,
    sunIntensity: 1.4,
    hemiSky: 0xb8e0ff,
    hemiGround: 0x6e543c,
    hemiIntensity: 0.68,
    chandelierColor: 0xffdfad,
    chandelierIntensity: 1.25,
    grassTuftColor: 0x70bd52,
    grassHueBase: 0.28,
    leafLight: 0x6ab852,
    leafMid: 0x4f993f,
    leafDark: 0x39782f,
  },
  {
    id: 'sunset',
    label: 'Багряный закат',
    skyZenith: [0.24, 0.22, 0.52],
    skyMid: [0.72, 0.42, 0.54],
    skyHorizon: [0.99, 0.64, 0.38],
    skyGround: [0.38, 0.30, 0.34],
    sceneBg: 0xc97b58,
    fogColor: 0x38202c,
    fogDensity: 0.0022,
    sunDir: [-108, 22, 26],
    sunColor: 0xff9e66,
    sunIntensity: 1.28,
    hemiSky: 0xffb88c,
    hemiGround: 0x59362b,
    hemiIntensity: 0.58,
    chandelierColor: 0xffbe73,
    chandelierIntensity: 1.65,
    grassTuftColor: 0x739c3e,
    grassHueBase: 0.23,
    leafLight: 0x829c3f,
    leafMid: 0x5d7a32,
    leafDark: 0x425925,
  },
  {
    id: 'twilight',
    label: 'Звёздные сумерки',
    skyZenith: [0.06, 0.11, 0.28],
    skyMid: [0.16, 0.24, 0.48],
    skyHorizon: [0.46, 0.42, 0.62],
    skyGround: [0.16, 0.19, 0.26],
    sceneBg: 0x263259,
    fogColor: 0x181c2e,
    fogDensity: 0.0024,
    sunDir: [-85, 52, -32],
    sunColor: 0xb0ccff,
    sunIntensity: 0.95,
    hemiSky: 0x6f8fd6,
    hemiGround: 0x423026,
    hemiIntensity: 0.55,
    chandelierColor: 0xffc778,
    chandelierIntensity: 1.85,
    grassTuftColor: 0x417a48,
    grassHueBase: 0.34,
    leafLight: 0x3f784c,
    leafMid: 0x2f5e3b,
    leafDark: 0x20422b,
  },
  {
    id: 'mint',
    label: 'Весенняя свежесть',
    skyZenith: [0.18, 0.52, 0.78],
    skyMid: [0.48, 0.80, 0.88],
    skyHorizon: [0.88, 0.94, 0.84],
    skyGround: [0.44, 0.58, 0.46],
    sceneBg: 0x7bcce0,
    fogColor: 0x2a3338,
    fogDensity: 0.0018,
    sunDir: [95, 54, -22],
    sunColor: 0xfff5d6,
    sunIntensity: 1.38,
    hemiSky: 0xaef0e6,
    hemiGround: 0x664d36,
    hemiIntensity: 0.66,
    chandelierColor: 0xffe4b0,
    chandelierIntensity: 1.3,
    grassTuftColor: 0x5cc466,
    grassHueBase: 0.31,
    leafLight: 0x6ad16f,
    leafMid: 0x4ea854,
    leafDark: 0x357a3c,
  },
  {
    id: 'crimson',
    label: 'Алый вечер',
    skyZenith: [0.28, 0.16, 0.38],
    skyMid: [0.68, 0.32, 0.42],
    skyHorizon: [0.96, 0.58, 0.42],
    skyGround: [0.36, 0.25, 0.28],
    sceneBg: 0xb85e54,
    fogColor: 0x361b24,
    fogDensity: 0.0021,
    sunDir: [104, 24, -44],
    sunColor: 0xffa678,
    sunIntensity: 1.25,
    hemiSky: 0xf7a896,
    hemiGround: 0x593429,
    hemiIntensity: 0.58,
    chandelierColor: 0xffca80,
    chandelierIntensity: 1.68,
    grassTuftColor: 0x6f9442,
    grassHueBase: 0.24,
    leafLight: 0x8f7a3e,
    leafMid: 0x69592e,
    leafDark: 0x473c1f,
  },
  {
    id: 'autumn',
    label: 'Осенний листопад',
    skyZenith: [0.22, 0.40, 0.68],
    skyMid: [0.54, 0.66, 0.80],
    skyHorizon: [0.95, 0.78, 0.56],
    skyGround: [0.48, 0.38, 0.28],
    sceneBg: 0x99a8bd,
    fogColor: 0x362a24,
    fogDensity: 0.002,
    sunDir: [100, 32, 34],
    sunColor: 0xffd596,
    sunIntensity: 1.32,
    hemiSky: 0xd6d2e8,
    hemiGround: 0x73492c,
    hemiIntensity: 0.62,
    chandelierColor: 0xffc87a,
    chandelierIntensity: 1.5,
    grassTuftColor: 0xa68c3a,
    grassHueBase: 0.13,
    leafLight: 0xe08434,
    leafMid: 0xc25b27,
    leafDark: 0x8c3a1b,
  },
  {
    id: 'winter',
    label: 'Морозный рассвет',
    skyZenith: [0.28, 0.48, 0.76],
    skyMid: [0.64, 0.80, 0.94],
    skyHorizon: [0.92, 0.94, 0.98],
    skyGround: [0.68, 0.74, 0.82],
    sceneBg: 0xa8cbe8,
    fogColor: 0x2c384a,
    fogDensity: 0.0019,
    sunDir: [88, 30, 48],
    sunColor: 0xeaf4ff,
    sunIntensity: 1.28,
    hemiSky: 0xcce8ff,
    hemiGround: 0x686e7d,
    hemiIntensity: 0.7,
    chandelierColor: 0xffd699,
    chandelierIntensity: 1.55,
    grassTuftColor: 0x9bb8b2,
    grassHueBase: 0.46,
    leafLight: 0xbcd4dc,
    leafMid: 0x7b9e9e,
    leafDark: 0x4f7378,
  },
  {
    id: 'lavender',
    label: 'Лавандовые сумерки',
    skyZenith: [0.22, 0.24, 0.56],
    skyMid: [0.50, 0.46, 0.78],
    skyHorizon: [0.90, 0.74, 0.82],
    skyGround: [0.34, 0.32, 0.44],
    sceneBg: 0x7d74b3,
    fogColor: 0x282238,
    fogDensity: 0.0021,
    sunDir: [-96, 36, 20],
    sunColor: 0xffd6cc,
    sunIntensity: 1.18,
    hemiSky: 0xcabaff,
    hemiGround: 0x5c4238,
    hemiIntensity: 0.62,
    chandelierColor: 0xffd18c,
    chandelierIntensity: 1.65,
    grassTuftColor: 0x5a9e5c,
    grassHueBase: 0.32,
    leafLight: 0x639e68,
    leafMid: 0x477a4e,
    leafDark: 0x305738,
  },
  {
    id: 'emerald',
    label: 'Летний зенит',
    skyZenith: [0.12, 0.48, 0.86],
    skyMid: [0.34, 0.74, 0.96],
    skyHorizon: [0.82, 0.92, 0.88],
    skyGround: [0.38, 0.54, 0.38],
    sceneBg: 0x5caee6,
    fogColor: 0x242e30,
    fogDensity: 0.0017,
    sunDir: [74, 62, 16],
    sunColor: 0xfffae0,
    sunIntensity: 1.42,
    hemiSky: 0xa6dcff,
    hemiGround: 0x66482f,
    hemiIntensity: 0.65,
    chandelierColor: 0xffdc9e,
    chandelierIntensity: 1.32,
    grassTuftColor: 0x55b842,
    grassHueBase: 0.28,
    leafLight: 0x53b844,
    leafMid: 0x3c9132,
    leafDark: 0x286923,
  },
];

const WALL_KITCHEN_COLORS = [0xcabfa9, 0xc4cfb8, 0xd8c7b2, 0xbec8cc, 0xd9c2a3, 0xc7c2d1];
const WALL_LIVING_TINTS = [0xffffff, 0xf2e4d0, 0xdce8dc, 0xe8d8dc, 0xdfe4f2, 0xf2ebd2];
const WALL_BEDROOM_COLORS = [0x9fb0a8, 0xa8a2bd, 0xb8a397, 0x92a8b8, 0xa6b594, 0xc2b299];
const CABINET_COLORS = [0x526b60, 0x42566e, 0x7c453a, 0x6b6043, 0x59425e, 0x856846, 0x3c5c5c, 0x704b39];
const SOFA_COLORS = [0x62493a, 0x395066, 0x6e3736, 0x455c44, 0x5e4561, 0x7a5b32, 0x424a52];
const CUSHION_COLORS = [0x765846, 0x4c6882, 0x854947, 0x597358, 0x735675, 0x916e42, 0x56606b];
const WOOD_DARK_COLORS = [0x573722, 0x422a1b, 0x613924, 0x4a3428, 0x3d2e24];
const WOOD_MED_COLORS = [0x825736, 0x73492b, 0x96643c, 0x7a5a42, 0x694c37];
const QUILT_TINTS = [0xffffff, 0xe0f0ff, 0xffe2d6, 0xe4f5dc, 0xf2e3ff, 0xfff0cc];
const CURTAIN_TINTS = [0xffffff, 0xf2d9c2, 0xcde3e8, 0xe8d1dc, 0xdde8cc, 0xf5e8bd];
const RUG_TINTS = [0xffffff, 0xe5d6eb, 0xd4ebe2, 0xf5decb, 0xdbe5f5, 0xede5c7];
const FENCE_COLORS = [0xd9d2c5, 0xc9bfa8, 0xd4ded3, 0xbdb09c, 0xe0d8cc];
const MAILBOX_COLORS = [0x3b6388, 0x943c32, 0x3f6e4b, 0x785535, 0x544675];
const HUMAN_SHIRTS = [0x8f5d42, 0x4f6880, 0x7a4146, 0x596e4b, 0x735c40, 0x5c4f6e];
const HUMAN_CARDIGANS = [0x4b5c47, 0x3f4754, 0x5e3d35, 0x4e4332, 0x3c524f, 0x4a3f54];

const LAYOUT_NAMES = [
  'Классический особняк',
  'Зеркальная вилла',
  'Дом с кухонным островом',
  'Зеркальный остров-лофт',
  'Усадьба с камином',
  'Зеркальная усадьба с камином',
];

function buildHouseByIndex(houseNumber: number): HouseBlueprint {
  const id = ((houseNumber - 1 + HOUSES_COUNT) % HOUSES_COUNT) + 1;
  const zeroIdx = id - 1;
  const seed = (id * 2654435761) >>> 0;
  const rng = createSeededRng(seed);

  const district = DISTRICTS[Math.floor(zeroIdx / 10) % DISTRICTS.length];
  const arch = HOUSE_ARCHETYPES[zeroIdx % HOUSE_ARCHETYPES.length];
  const adj = HOUSE_ADJECTIVES[(Math.floor(zeroIdx / 10) + zeroIdx * 3) % HOUSE_ADJECTIVES.length];

  const name = `Дом #${id}: ${adj} ${arch.baseName}`;

  const layoutId = (zeroIdx % 6) as 0 | 1 | 2 | 3 | 4 | 5;
  const mirrorX = layoutId % 2 === 1;
  const wingMode = Math.floor(layoutId / 2) as WingMode;

  const mood = MOOD_LIST[(zeroIdx + Math.floor(zeroIdx / 10) * 2) % MOOD_LIST.length];

  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

  const palette: HousePalette = {
    wallKitchen: pick(WALL_KITCHEN_COLORS),
    wallLivingTint: pick(WALL_LIVING_TINTS),
    wallBedroom: pick(WALL_BEDROOM_COLORS),
    baseboard: rng() > 0.5 ? 0xded5c5 : 0xd2c7b5,
    woodDark: pick(WOOD_DARK_COLORS),
    woodMed: pick(WOOD_MED_COLORS),
    cabinet: pick(CABINET_COLORS),
    sofa: pick(SOFA_COLORS),
    cushion: pick(CUSHION_COLORS),
    quiltTint: pick(QUILT_TINTS),
    curtainTint: pick(CURTAIN_TINTS),
    rugTint: pick(RUG_TINTS),
    fence: pick(FENCE_COLORS),
    mailbox: pick(MAILBOX_COLORS),
    humanShirt: pick(HUMAN_SHIRTS),
    humanCardigan: pick(HUMAN_CARDIGANS),
  };

  const tier = Math.floor(zeroIdx / 20); // 0..4
  const insectCount = Math.min(12, 7 + tier + Math.floor(rng() * 2));
  const extraPropCount = 6 + Math.floor(rng() * 7);

  const layoutName = LAYOUT_NAMES[layoutId];

  const summary: HouseSummary = {
    id,
    name,
    district,
    themeLabel: arch.themeLabel,
    moodLabel: mood.label,
    layoutName,
  };

  return {
    id,
    seed,
    name,
    district,
    themeLabel: arch.themeLabel,
    layoutId,
    layoutName,
    mirrorX,
    wingMode,
    mood,
    palette,
    insectCount,
    extraPropCount,
    treeSeed: Math.floor(rng() * 10000),
    preferredCategories: arch.preferred,
    summary,
  };
}

const HOUSE_CACHE = new Map<number, HouseBlueprint>();

export function getHouseBlueprint(dayOrHouseNumber: number): HouseBlueprint {
  const normalized = (((Math.floor(dayOrHouseNumber) - 1) % HOUSES_COUNT) + HOUSES_COUNT) % HOUSES_COUNT + 1;
  let cached = HOUSE_CACHE.get(normalized);
  if (!cached) {
    cached = buildHouseByIndex(normalized);
    HOUSE_CACHE.set(normalized, cached);
  }
  return cached;
}

export function getAllHouseSummaries(): HouseSummary[] {
  const list: HouseSummary[] = [];
  for (let i = 1; i <= HOUSES_COUNT; i++) {
    list.push(getHouseBlueprint(i).summary);
  }
  return list;
}
