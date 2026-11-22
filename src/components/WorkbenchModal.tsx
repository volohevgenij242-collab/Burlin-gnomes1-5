import React from 'react';
import { Hammer, X } from 'lucide-react';
import { CraftUpgrades, HudSnapshot } from '../types/game';

interface WorkbenchModalProps {
  hud: HudSnapshot;
  onCraft: (item: keyof CraftUpgrades) => void;
  onClose: () => void;
}

export const WorkbenchModal: React.FC<WorkbenchModalProps> = ({ hud, onCraft, onClose }) => {
  const recipes: Array<{
    key: keyof CraftUpgrades;
    name: string;
    desc: string;
    costText: string;
    canAfford: boolean;
  }> = [
    {
      key: 'stick',
      name: 'Дубинка-палка с гвоздём',
      desc: 'Позволяет отбиваться от тараканов и пауков (ЛКМ, когда руки свободны).',
      costText: '2 Хлама или 20 Блестяшек',
      canAfford: hud.scrap >= 2 || hud.shinies >= 20,
    },
    {
      key: 'gloves',
      name: 'Перчатки Гномиума',
      desc: 'Ускоряют бег (+24%) и карабканье по шторам/лозам, снижают штраф тяжести.',
      costText: '35 Блестяшек',
      canAfford: hud.shinies >= 35,
    },
    {
      key: 'boots',
      name: 'Прыгучие ботинки',
      desc: 'Супер-прыжок (+45% высоты), чтобы легко запрыгивать на стулья и столы.',
      costText: '45 Блестяшек',
      canAfford: hud.shinies >= 45,
    },
    {
      key: 'drone',
      name: 'Мавик-Дрон гномов',
      desc: 'FPV-квадрокоптер [F]: разведка, лёгкий груз (ЛКМ) и электрошокер против деда и жуков (ПКМ).',
      costText: '2 Хлама или 30 Блестяшек',
      canAfford: hud.scrap >= 2 || hud.shinies >= 30,
    },
  ];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
      <div className="w-full max-w-lg rounded-xl bg-[#1c1510] border border-[#5c4837] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#3d3025] pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <Hammer className="w-5 h-5 text-[#e5b95c]" />
            <h2 className="text-xl font-bold text-[#f7efe4]">Верстак гномов</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#2a2019] hover:bg-[#3a2c22] text-[#d6cab9] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-6 mb-4 text-sm bg-[#140f0c] px-4 py-2 rounded-lg border border-[#3a2d22]">
          <span className="text-[#f0c76e] font-semibold tabular-nums">
            Блестяшки: {hud.shinies}
          </span>
          <span className="text-[#a5b5c4] font-semibold tabular-nums">
            Хлам: {hud.scrap}
          </span>
        </div>

        <div className="space-y-3">
          {recipes.map((r) => {
            const owned = hud.upgrades[r.key];
            return (
              <div
                key={r.key}
                className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[#241b15] border border-[#47382b]"
              >
                <div>
                  <div className="font-bold text-sm text-[#f7efe4]">{r.name}</div>
                  <div className="text-xs text-[#cbbda9] mt-0.5">{r.desc}</div>
                  <div className="text-xs text-[#e5b95c] mt-1 font-medium">Цена: {r.costText}</div>
                </div>
                {owned ? (
                  <span className="px-3 py-1.5 rounded bg-[#274033] text-[#7be3b0] text-xs font-bold shrink-0">
                    Создано
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!r.canAfford}
                    onClick={() => onCraft(r.key)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-bold shrink-0 transition ${
                      r.canAfford
                        ? 'bg-[#c43a2d] hover:bg-[#d64536] text-white cursor-pointer'
                        : 'bg-[#2c241e] text-[#75675a] cursor-not-allowed'
                    }`}
                  >
                    Скрафтить
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#33271e] hover:bg-[#423328] text-sm font-semibold text-[#f5ebdc] cursor-pointer"
          >
            Вернуться в игру (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
