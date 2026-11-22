import React, { useState } from 'react';
import { Crown, RotateCcw, ArrowRight, Copy, Check, LogOut } from 'lucide-react';
import { getHouseBlueprint } from '../game/houses';
import { GameScreen, HudSnapshot } from '../types/game';

interface ModalsProps {
  screen: GameScreen;
  hud: HudSnapshot;
  onResume: () => void;
  onExtract: () => void;
  onNextDay: () => void;
  onRetryDay: () => void;
  onLeaveServer: () => void;
}

export const GameModals: React.FC<ModalsProps> = ({
  screen,
  hud,
  onResume,
  onExtract,
  onNextDay,
  onRetryDay,
  onLeaveServer,
}) => {
  const [copied, setCopied] = useState(false);
  const mp = hud.multiplayer;
  const isMp = Boolean(mp?.active);
  const isHostOrSolo = !isMp || Boolean(mp?.isHost);

  const handleCopyCode = () => {
    if (!mp?.roomCode) return;
    navigator.clipboard?.writeText(mp.roomCode).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (screen === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
        <div className="w-full max-w-sm rounded-xl bg-[#1c1510] border border-[#5c4837] p-6 text-center space-y-4">
          <h2 className="text-2xl font-black text-[#f7efe4]">Пауза</h2>
          <div className="text-xs text-[#cbbda9] space-y-0.5">
            <p className="font-semibold text-[#e5b95c]">{hud.house.name}</p>
            <p>
              День {hud.day} · Заданий: {hud.completedQuestsCount}/{hud.quests.length} (нужно {hud.minQuestsRequired})
            </p>
          </div>

          {mp && mp.active && (
            <div className="bg-[#140f0c] border border-[#3d3025] rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs">
              <div className="text-left">
                <div className="text-[10px] text-[#a89a87]">{mp.roomName}</div>
                <div className="font-mono font-bold text-[#e5b95c] text-sm tracking-widest">
                  Код: {mp.roomCode}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#292019] hover:bg-[#382c22] border border-[#544335] text-[#f5ebdc] cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#7be3b0]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-2.5 rounded-lg bg-[#c43a2d] hover:bg-[#d64536] text-white font-bold text-sm cursor-pointer"
            >
              Продолжить вылазку
            </button>
            {isHostOrSolo && (
              <button
                type="button"
                onClick={onRetryDay}
                className="w-full py-2.5 rounded-lg bg-[#2c221b] hover:bg-[#3b2e24] text-[#e8ddd0] font-semibold text-sm cursor-pointer"
              >
                Начать день заново
              </button>
            )}
            <button
              type="button"
              onClick={onLeaveServer}
              className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-[#251b15] hover:bg-[#33241c] border border-[#4a392c] text-[#cbbda9] font-semibold text-xs cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isMp ? 'Покинуть сервер' : 'В главное меню'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'highgnome') {
    const canExtract = hud.completedQuestsCount >= hud.minQuestsRequired;
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
        <div className="w-full max-w-lg rounded-xl bg-[#1c1510] border border-[#5c4837] p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Crown className="w-6 h-6 text-[#e5b95c]" />
            <h2 className="text-xl font-bold text-[#f7efe4]">Верховный Гном</h2>
          </div>
          <p className="text-sm text-[#d6cab9] leading-relaxed">
            «Сегодня перед нами {hud.house.name} ({hud.house.district}). Приносите добычу на красный коврик передо мной —
            выполните хотя бы {hud.minQuestsRequired} из {hud.quests.length} поручений до конца дня!»
          </p>

          <div className="space-y-2 bg-[#140f0c] p-3.5 rounded-lg border border-[#3d3025]">
            {hud.quests.map((q) => (
              <div key={q.id} className="flex items-center justify-between text-xs">
                <div>
                  <div className={q.completed ? 'text-[#7be3b0] line-through font-semibold' : 'text-[#f5ebdc] font-semibold'}>
                    {q.title}
                  </div>
                  <div className="text-[#a89b8a]">{q.description}</div>
                </div>
                <span className="font-mono font-bold tabular-nums text-[#e5b95c]">
                  {Math.min(q.currentCount, q.requiredCount)}/{q.requiredCount}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {canExtract && isHostOrSolo && (
              <button
                type="button"
                onClick={onExtract}
                className="px-4 py-2 rounded-lg bg-[#2f7d52] hover:bg-[#389462] text-white text-sm font-bold cursor-pointer"
              >
                Завершить день с победой
              </button>
            )}
            {canExtract && !isHostOrSolo && (
              <span className="text-xs text-[#7be3b0] font-medium">
                Цель выполнена! Хост может завершить день.
              </span>
            )}
            <button
              type="button"
              onClick={onResume}
              className="px-4 py-2 rounded-lg bg-[#c43a2d] hover:bg-[#d64536] text-white text-sm font-bold cursor-pointer"
            >
              За дело! (Esc)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'summary') {
    const won = hud.summaryReason === 'extracted' || hud.completedQuestsCount >= hud.minQuestsRequired;
    const title =
      hud.summaryReason === 'caught'
        ? 'Хозяин поймал отряд!'
        : hud.summaryReason === 'knocked_out'
          ? 'Насекомые одолели!'
          : hud.summaryReason === 'time_up' && !won
            ? 'Время вышло!'
            : `День ${hud.day} успешно завершён!`;

    const nextHouse = getHouseBlueprint(hud.day + 1);

    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
        <div className="w-full max-w-md rounded-xl bg-[#1c1510] border border-[#5c4837] p-6 text-center space-y-4">
          <h2 className={`text-2xl font-black ${won ? 'text-[#7be3b0]' : 'text-[#ff786b]'}`}>
            {title}
          </h2>
          <div className="text-xs text-[#e5b95c] font-semibold">
            {hud.house.name} · {hud.house.moodLabel}
          </div>
          <div className="text-sm text-[#d6cab9] space-y-1">
            <p>Выполнено заданий: <strong className="text-white tabular-nums">{hud.completedQuestsCount} / {hud.quests.length}</strong></p>
            <p>Накоплено блестяшек: <strong className="text-[#f0c76e] tabular-nums">{hud.shinies}</strong></p>
            <p>Хлам для верстака: <strong className="text-[#a5b5c4] tabular-nums">{hud.scrap}</strong></p>
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            {isHostOrSolo ? (
              won ? (
                <button
                  type="button"
                  onClick={onNextDay}
                  className="flex flex-col items-center justify-center w-full py-2.5 px-3 rounded-lg bg-[#2f7d52] hover:bg-[#389462] text-white font-bold text-sm cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span>Следующий день (День {hud.day + 1} · Дом #{nextHouse.id})</span>
                    <ArrowRight className="w-4 h-4" />
                  </span>
                  <span className="text-[11px] font-normal text-[#d5f5e3] truncate max-w-full">
                    {nextHouse.name} · {nextHouse.mood.label}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onRetryDay}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#c43a2d] hover:bg-[#d64536] text-white font-bold text-sm cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Повторить День {hud.day}</span>
                </button>
              )
            ) : (
              <div className="py-2 px-3 rounded-lg bg-[#140f0c] border border-[#3d3025] text-xs text-[#e5b95c]">
                Ожидаем, пока хост запустит следующий этап...
              </div>
            )}

            <button
              type="button"
              onClick={onLeaveServer}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[#251b15] hover:bg-[#33241c] border border-[#4a392c] text-[#cbbda9] font-semibold text-xs cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isMp ? 'Покинуть сервер' : 'В главное меню'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
