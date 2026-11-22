import type { ItemCategory, Quest } from '../types/game';
import { createSeededRng, getHouseBlueprint } from './houses';

interface QuestTemplate {
  key: string;
  type: Quest['type'];
  targetCategory: ItemCategory;
  title: string;
  description: string;
  requiredCount: number;
  rewardShinies: number;
}

export const QUEST_POOL: QuestTemplate[] = [
  // ---- STEAL: Kitchen & Pantry ----
  {
    key: 'cheese-1',
    type: 'steal',
    targetCategory: 'cheese',
    title: 'Сырный налёт',
    description: 'Принеси кусок сыра на красный коврик в норе',
    requiredCount: 1,
    rewardShinies: 25,
  },
  {
    key: 'cheese-2',
    type: 'steal',
    targetCategory: 'cheese',
    title: 'Двойной сырный пир',
    description: 'Утащи 2 куска ароматного сыра в убежище',
    requiredCount: 2,
    rewardShinies: 45,
  },
  {
    key: 'apple-1',
    type: 'steal',
    targetCategory: 'apple',
    title: 'Витаминный трофей',
    description: 'Укради спелое яблоко со стола или стойки',
    requiredCount: 1,
    rewardShinies: 25,
  },
  {
    key: 'apple-2',
    type: 'steal',
    targetCategory: 'apple',
    title: 'Фруктовый запас',
    description: 'Прикати в нору 2 сочных яблока',
    requiredCount: 2,
    rewardShinies: 42,
  },
  {
    key: 'fork-1',
    type: 'steal',
    targetCategory: 'fork',
    title: 'Трофейная вилка',
    description: 'Утащи стальную вилку со стола или стойки',
    requiredCount: 1,
    rewardShinies: 20,
  },
  {
    key: 'fork-2',
    type: 'steal',
    targetCategory: 'fork',
    title: 'Набор фехтовальщика',
    description: 'Доставь в нору 2 стальные вилки',
    requiredCount: 2,
    rewardShinies: 38,
  },
  {
    key: 'spoon-1',
    type: 'steal',
    targetCategory: 'spoon',
    title: 'Серебряный черпак',
    description: 'Притащи столовую ложку в убежище гномов',
    requiredCount: 1,
    rewardShinies: 20,
  },
  {
    key: 'spoon-2',
    type: 'steal',
    targetCategory: 'spoon',
    title: 'Ложка к обеду',
    description: 'Принеси 2 столовые ложки для клана',
    requiredCount: 2,
    rewardShinies: 38,
  },

  // ---- STEAL: Valuables & Curios ----
  {
    key: 'coin-2',
    type: 'steal',
    targetCategory: 'coin',
    title: 'Золотой запас',
    description: 'Найди и принеси в нору 2 золотые монеты',
    requiredCount: 2,
    rewardShinies: 32,
  },
  {
    key: 'coin-3',
    type: 'steal',
    targetCategory: 'coin',
    title: 'Клад для короны',
    description: 'Собери по всему дому 3 золотые монеты',
    requiredCount: 3,
    rewardShinies: 52,
  },
  {
    key: 'ring-1',
    type: 'steal',
    targetCategory: 'ring',
    title: 'Рубиновый перстень',
    description: 'Похить драгоценное кольцо из спальни или кабинета',
    requiredCount: 1,
    rewardShinies: 40,
  },
  {
    key: 'ring-2',
    type: 'steal',
    targetCategory: 'ring',
    title: 'Королевская шкатулка',
    description: 'Добудь 2 драгоценных кольца для Верховного Гнома',
    requiredCount: 2,
    rewardShinies: 68,
  },
  {
    key: 'watch-1',
    type: 'steal',
    targetCategory: 'watch',
    title: 'Тикающий трофей',
    description: 'Укради золотые карманные часы хозяина',
    requiredCount: 1,
    rewardShinies: 38,
  },
  {
    key: 'watch-2',
    type: 'steal',
    targetCategory: 'watch',
    title: 'Время гномов',
    description: 'Принеси 2 карманных часов в убежище',
    requiredCount: 2,
    rewardShinies: 62,
  },
  {
    key: 'key-1',
    type: 'steal',
    targetCategory: 'key',
    title: 'Золотой ключ',
    description: 'Найди и утащи латунный ключ хозяина дома',
    requiredCount: 1,
    rewardShinies: 34,
  },
  {
    key: 'key-2',
    type: 'steal',
    targetCategory: 'key',
    title: 'Связка отмычек',
    description: 'Собери 2 латунных ключа в разных комнатах',
    requiredCount: 2,
    rewardShinies: 56,
  },

  // ---- STEAL: Living Room & Study Gadgets ----
  {
    key: 'remote-1',
    type: 'steal',
    targetCategory: 'remote',
    title: 'Тишина у телевизора',
    description: 'Стяни пульт от телевизора и унеси в нору',
    requiredCount: 1,
    rewardShinies: 32,
  },
  {
    key: 'candle-1',
    type: 'steal',
    targetCategory: 'candle',
    title: 'Свеча для котла',
    description: 'Унеси свечу в подсвечнике к очагу гномов',
    requiredCount: 1,
    rewardShinies: 30,
  },
  {
    key: 'candle-2',
    type: 'steal',
    targetCategory: 'candle',
    title: 'Вечерний свет норы',
    description: 'Добудь 2 восковые свечи для убежища',
    requiredCount: 2,
    rewardShinies: 50,
  },
  {
    key: 'matchbox-1',
    type: 'steal',
    targetCategory: 'matchbox',
    title: 'Тёплый огонёк',
    description: 'Добудь коробок спичек для Верховного Гнома',
    requiredCount: 1,
    rewardShinies: 22,
  },
  {
    key: 'matchbox-2',
    type: 'steal',
    targetCategory: 'matchbox',
    title: 'Запасы для костра',
    description: 'Принеси 2 коробка спичек в нору',
    requiredCount: 2,
    rewardShinies: 40,
  },

  // ---- VANDALISM: Smash & Tip Chaos ----
  {
    key: 'mug-1',
    type: 'vandalism',
    targetCategory: 'mug',
    title: 'Бей посуду!',
    description: 'Сбрось или брось (ПКМ) кружку, чтобы она разбилась',
    requiredCount: 1,
    rewardShinies: 25,
  },
  {
    key: 'mug-2',
    type: 'vandalism',
    targetCategory: 'mug',
    title: 'Кофейный погром',
    description: 'Разбей 2 керамические кружки в доме соседа',
    requiredCount: 2,
    rewardShinies: 44,
  },
  {
    key: 'vase-1',
    type: 'vandalism',
    targetCategory: 'vase',
    title: 'Фарфоровый звон',
    description: 'Расколоти расписную вазу хозяина (брось ПКМ)',
    requiredCount: 1,
    rewardShinies: 35,
  },
  {
    key: 'vase-2',
    type: 'vandalism',
    targetCategory: 'vase',
    title: 'Антикварный хаос',
    description: 'Разбей 2 фарфоровые вазы в комнатах дома',
    requiredCount: 2,
    rewardShinies: 58,
  },
  {
    key: 'plate-1',
    type: 'vandalism',
    targetCategory: 'plate',
    title: 'Тарелочный салют',
    description: 'Разбей декоративную тарелку о пол',
    requiredCount: 1,
    rewardShinies: 28,
  },
  {
    key: 'plate-2',
    type: 'vandalism',
    targetCategory: 'plate',
    title: 'Сервиз вдребезги',
    description: 'Разбей 2 расписные тарелки на кухне или в гостиной',
    requiredCount: 2,
    rewardShinies: 48,
  },
  {
    key: 'trashbin-1',
    type: 'vandalism',
    targetCategory: 'trashbin',
    title: 'Переполох на кухне',
    description: 'Опрокинь гигантское мусорное ведро в доме',
    requiredCount: 1,
    rewardShinies: 36,
  },

  // ---- RESOURCE: Crafting & Energy ----
  {
    key: 'battery-1',
    type: 'resource',
    targetCategory: 'battery',
    title: 'Заряд для норы',
    description: 'Укради батарейку AA и принеси в убежище',
    requiredCount: 1,
    rewardShinies: 26,
  },
  {
    key: 'battery-2',
    type: 'resource',
    targetCategory: 'battery',
    title: 'Электро-бум',
    description: 'Доставь 2 батарейки AA на коврик гномов',
    requiredCount: 2,
    rewardShinies: 46,
  },
  {
    key: 'scrap-2',
    type: 'resource',
    targetCategory: 'scrap',
    title: 'Детали для верстака',
    description: 'Принеси 2 единицы латунного хлама в нору',
    requiredCount: 2,
    rewardShinies: 28,
  },
  {
    key: 'scrap-3',
    type: 'resource',
    targetCategory: 'scrap',
    title: 'Большая кузница',
    description: 'Собери 3 комплекта латунных шестерёнок и пружин',
    requiredCount: 3,
    rewardShinies: 48,
  },
];

export const DAILY_QUEST_COUNT = 6;

export function generateDailyQuests(day: number, extraSeed = 0): Quest[] {
  const house = getHouseBlueprint(day);
  const rng = createSeededRng((day * 7919 + house.seed + extraSeed * 104729) >>> 0);

  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const picked: QuestTemplate[] = [];
  const usedCategories = new Set<ItemCategory>();

  const tryPickFrom = (candidates: QuestTemplate[]): boolean => {
    for (const tpl of shuffle(candidates)) {
      if (usedCategories.has(tpl.targetCategory)) continue;
      // Avoid overly high multi-count quests on Day 1-2 so opening raid feels snappy
      if (day <= 2 && tpl.requiredCount >= 3) continue;
      picked.push(tpl);
      usedCategories.add(tpl.targetCategory);
      return true;
    }
    return false;
  };

  // 1. At least one signature quest themed to this house's owner/archetype
  tryPickFrom(QUEST_POOL.filter((q) => house.preferredCategories.includes(q.targetCategory)));

  // 2. Guaranteed 1 vandalism mission (smash mug/vase/plate or tip trashbin)
  tryPickFrom(QUEST_POOL.filter((q) => q.type === 'vandalism'));

  // 3. Guaranteed 1 resource/craft mission (scrap or battery)
  tryPickFrom(QUEST_POOL.filter((q) => q.type === 'resource'));

  // 4. Fill remaining slots up to DAILY_QUEST_COUNT with varied missions (preferring house themes + distinct types)
  const poolShuffled = shuffle(QUEST_POOL);
  for (const tpl of poolShuffled) {
    if (picked.length >= DAILY_QUEST_COUNT) break;
    if (usedCategories.has(tpl.targetCategory)) continue;
    if (day <= 2 && tpl.requiredCount >= 3) continue;
    picked.push(tpl);
    usedCategories.add(tpl.targetCategory);
  }

  return picked.map((tpl, idx) => ({
    id: `day-${day}-h${house.id}-q-${idx}`,
    type: tpl.type,
    targetCategory: tpl.targetCategory,
    title: tpl.title,
    description: tpl.description,
    requiredCount: tpl.requiredCount,
    currentCount: 0,
    completed: false,
    rewardShinies: tpl.rewardShinies,
  }));
}
