import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Crown,
  MessageSquare,
} from 'lucide-react';
import { GNOME_COLOR_PALETTE } from '../game/models';
import { HudSnapshot } from '../types/game';

interface HUDProps {
  hud: HudSnapshot;
  onToggleMute: () => void;
  onOpenPause: () => void;
  onSendChat: (text: string) => void;
  onChatTypingChange: (typing: boolean) => void;
  onDeployFromTree: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const HUD: React.FC<HUDProps> = ({
  hud,
  onToggleMute,
  onOpenPause,
  onSendChat,
  onChatTypingChange,
  onDeployFromTree,
}) => {
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const mp = hud.multiplayer;

  useEffect(() => {
    if (!mp?.active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && !chatOpen && !e.repeat) {
        e.preventDefault();
        setChatOpen(true);
        onChatTypingChange(true);
      } else if (e.code === 'Escape' && chatOpen) {
        e.preventDefault();
        setChatOpen(false);
        setChatDraft('');
        onChatTypingChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mp?.active, chatOpen, onChatTypingChange]);

  useEffect(() => {
    if (chatOpen) {
      window.setTimeout(() => chatInputRef.current?.focus(), 20);
    }
  }, [chatOpen]);

  const handleCopyCode = () => {
    if (!mp?.roomCode) return;
    navigator.clipboard?.writeText(mp.roomCode).catch(() => undefined);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  };

  const handleSubmitChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatDraft.trim()) {
      onSendChat(chatDraft);
    }
    setChatDraft('');
    setChatOpen(false);
    onChatTypingChange(false);
  };

  const weaponLabel =
    hud.humanWeapon === 'revolver'
      ? 'Револьвер'
      : hud.humanWeapon === 'rifle'
        ? 'Винтовка'
        : hud.humanWeapon === 'shotgun'
          ? 'Дробовик'
          : null;

  const alertBadge = (() => {
    if (hud.isDowned) {
      return {
        text: `Без сознания (${hud.respawnTimer}с)`,
        color: 'text-[#ff786b] border-[#a83228]',
        Icon: ShieldAlert,
      };
    }
    if (hud.isGrabbedByHuman) {
      return { text: 'СХВАЧЕН СОСЕДОМ!', color: 'text-[#ff786b] border-[#a83228]', Icon: ShieldAlert };
    }
    if (hud.inTreeHub) {
      return { text: 'Дерево с глазами (Хаб)', color: 'text-[#7be3b0] border-[#3d7a5b]', Icon: EyeOff };
    }
    if (hud.giantGnomeActive) {
      return {
        text: `БОЛЬШОЙ ГНОМ! (${hud.giantGnomeDistance} м)`,
        color: 'text-[#ff786b] border-[#d93829]',
        Icon: ShieldAlert,
      };
    }
    if (hud.humanDead) {
      return { text: 'Сосед повержен!', color: 'text-[#f2bc57] border-[#9e7424]', Icon: ShieldAlert };
    }
    if (hud.inBurrow) {
      return { text: 'В норе (безопасно)', color: 'text-[#7be3b0] border-[#3d7a5b]', Icon: EyeOff };
    }
    if (hud.isOutside) {
      return { text: 'На улице (беги в дверь!)', color: 'text-[#f2bc57] border-[#9e7424]', Icon: Eye };
    }
    if (hud.isHidden) {
      return { text: 'Спрятан', color: 'text-[#7be3b0] border-[#3d7a5b]', Icon: EyeOff };
    }
    if (hud.humanAlert === 'chase') {
      const wText = weaponLabel ? ` · ${weaponLabel}` : '';
      return { text: `ПОГОНЯ! (${hud.humanDistance} дм)${wText}`, color: 'text-[#ff786b] border-[#a83228]', Icon: ShieldAlert };
    }
    if (hud.humanAlert === 'suspicious') {
      return { text: 'Сосед насторожен', color: 'text-[#f2bc57] border-[#9e7424]', Icon: Eye };
    }
    return { text: `Сосед: ${hud.humanDistance} дм`, color: 'text-[#d8cbb8] border-[#4f4033]', Icon: Eye };
  })();

  const AlertIcon = alertBadge.Icon;
  const stealthVignetteActive = hud.isCrouching || (hud.isHidden && !hud.inBurrow) || hud.isDowned;

  const missingLimbs: string[] = [];
  if (hud.dismemberMask & 1) missingLimbs.push('Л. рука');
  if (hud.dismemberMask & 2) missingLimbs.push('П. рука');
  if (hud.dismemberMask & 4) missingLimbs.push('Л. нога');
  if (hud.dismemberMask & 8) missingLimbs.push('П. нога');
  if (hud.dismemberMask & 16) missingLimbs.push('Колпак');

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4">
      {/* Smooth Stealth Edge Vignette (pure radial-gradient, no backdrop-filter) */}
      <div
        className={`fixed inset-0 pointer-events-none transition-opacity duration-300 ${
          stealthVignetteActive ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: hud.isDowned
            ? 'radial-gradient(circle at center, rgba(90,15,10,0.22) 25%, rgba(18, 4, 4, 0.8) 100%)'
            : 'radial-gradient(circle at center, transparent 48%, rgba(8, 10, 14, 0.58) 100%)',
        }}
      />

      {/* Top Row: Left Status + Squad Cluster, Right Quests Cluster */}
      <div className="relative flex items-start justify-between gap-4">
        {/* Top-Left Status Cluster */}
        <div className="space-y-2">
          <div className="bg-[#18120e]/85 border border-[#4a3b2e] rounded-lg px-3.5 py-2.5 text-xs space-y-2 min-w-[238px] max-w-[270px]">
            <div className="flex items-center justify-between gap-4">
              <span className="font-bold text-[#e5b95c] tracking-wide uppercase">
                День {hud.day} · Дом #{hud.house.id}/100
              </span>
              <span className="font-mono font-bold text-sm tabular-nums text-[#f7efe4]">
                {hud.dayStarted ? formatTime(hud.timeRemaining) : 'ПОДГОТОВКА'}
              </span>
            </div>
            <div className="border-b border-[#3b2f24] pb-1.5 -mt-1">
              <div className="text-[11px] font-semibold text-[#f3e8d8] truncate">
                {hud.house.name}
              </div>
              <div className="text-[10px] text-[#b3a38f] truncate">
                {hud.house.district} · {hud.house.moodLabel}
              </div>
            </div>

            {/* HP & Stamina */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#cbbda9]">
                <span>Здоровье</span>
                <span className="tabular-nums font-semibold">{hud.hp}/{hud.maxHp}</span>
              </div>
              <div className="h-2 bg-[#2b211a] rounded overflow-hidden">
                <div
                  className="h-full bg-[#c94132] transition-[width] duration-150"
                  style={{ width: `${Math.max(0, (hud.hp / hud.maxHp) * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#cbbda9] pt-0.5">
                <span>Выносливость</span>
                <span className="tabular-nums">{hud.stamina}%</span>
              </div>
              <div className="h-1.5 bg-[#2b211a] rounded overflow-hidden">
                <div
                  className="h-full bg-[#5b9a6f] transition-[width] duration-100"
                  style={{ width: `${hud.stamina}%` }}
                />
              </div>
            </div>

            {/* Stealth / Human Distance */}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-medium ${alertBadge.color}`}>
              <AlertIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{alertBadge.text}</span>
            </div>

            {!hud.inTreeHub && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-[#d4c4b0]">
                  <span>{hud.humanDead ? 'Сосед повержен' : 'Здоровье Соседа'}</span>
                  <span className="tabular-nums font-semibold">
                    {hud.humanHp}/{hud.humanMaxHp}
                  </span>
                </div>
                <div className="h-1.5 bg-[#2b211a] rounded overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-150 ${
                      hud.humanDead ? 'bg-[#5c5349]' : 'bg-[#e38632]'
                    }`}
                    style={{ width: `${Math.max(0, (hud.humanHp / Math.max(1, hud.humanMaxHp)) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {(hud.dogAlert || hud.catAlert) && (
              <div className="flex flex-wrap gap-1">
                {hud.dogAlert && (
                  <span className="px-1.5 py-0.5 rounded bg-[#3b1915] border border-[#b54436] text-[10px] font-semibold text-[#ffb3a8]">
                    Собака атакует!
                  </span>
                )}
                {hud.catAlert && (
                  <span className="px-1.5 py-0.5 rounded bg-[#3d2814] border border-[#c77b2e] text-[10px] font-semibold text-[#ffd7a6]">
                    Кот охотится!
                  </span>
                )}
              </div>
            )}

            {/* Loot & Upgrades */}
            <div className="flex items-center justify-between pt-0.5 border-t border-[#3b2f24] text-[11px]">
              <span className="text-[#f0c76e] font-semibold tabular-nums">
                Блестяшки: {hud.shinies}
              </span>
              <span className="text-[#a5b5c4] font-semibold tabular-nums">
                Хлам: {hud.scrap}
              </span>
            </div>

            {(hud.upgrades.stick || hud.upgrades.gloves || hud.upgrades.boots || hud.hasDrone) && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {hud.upgrades.stick && (
                  <span className="px-1.5 py-0.5 rounded bg-[#382b21] border border-[#614a37] text-[10px] text-[#e8d9c5]">
                    Палка
                  </span>
                )}
                {hud.upgrades.gloves && (
                  <span className="px-1.5 py-0.5 rounded bg-[#273830] border border-[#456b59] text-[10px] text-[#a7e0c3]">
                    Перчатки
                  </span>
                )}
                {hud.upgrades.boots && (
                  <span className="px-1.5 py-0.5 rounded bg-[#263242] border border-[#445c7a] text-[10px] text-[#a6cbf2]">
                    Ботинки
                  </span>
                )}
                {hud.hasDrone && (
                  <span className="px-1.5 py-0.5 rounded bg-[#1f343d] border border-[#3d7085] text-[10px] text-[#8be3ff]">
                    Дрон [F] · {hud.droneBattery}%
                  </span>
                )}
              </div>
            )}

            {missingLimbs.length > 0 && (
              <div className="px-2 py-1 rounded border border-[#a83228] bg-[#2a1210]/90 text-[10px] text-[#ffb0a8] space-y-0.5">
                <div className="font-bold">Оторвано: {missingLimbs.join(', ')}</div>
                <div className="text-[#e6c4be]">Вернись в нору, чтобы пришить обратно</div>
              </div>
            )}
          </div>

          {/* Multiplayer Server Code & Squad Panel */}
          {mp && mp.active && (
            <div className="bg-[#18120e]/85 border border-[#4a3b2e] rounded-lg px-3.5 py-2 text-xs space-y-1.5 min-w-[238px]">
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-[#3b2f24]">
                <div className="min-w-0">
                  <div className="text-[10px] text-[#a89a87] truncate">{mp.roomName}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[#cbbda9]">Код:</span>
                    <span className="font-mono font-bold text-[#e5b95c] tracking-wider">{mp.roomCode}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  title="Скопировать код сервера"
                  className="pointer-events-auto p-1.5 rounded bg-[#292019] hover:bg-[#382c22] border border-[#544335] text-[#f5ebdc] cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-[#7be3b0]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {mp.connectionStatus !== 'connected' && (
                <div className="text-[10px] text-[#f2bc57] font-semibold">
                  Переподключение к серверу...
                </div>
              )}

              <ul className="space-y-1">
                {mp.players.map((pl) => {
                  const pal = GNOME_COLOR_PALETTE[pl.color] ?? GNOME_COLOR_PALETTE.red;
                  return (
                    <li key={pl.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/40"
                          style={{ backgroundColor: pal.hex }}
                        />
                        <span className={`truncate ${pl.id === mp.myId ? 'font-bold text-white' : 'text-[#d8cbb8]'}`}>
                          {pl.name}
                        </span>
                        {pl.isHost && <Crown className="w-3 h-3 text-[#e5b95c] shrink-0" />}
                      </div>
                      <span className={`font-mono text-[10px] tabular-nums ${pl.isDowned ? 'text-[#ff786b]' : 'text-[#9ec7a7]'}`}>
                        {pl.isDowned ? 'УПАЛ' : `${pl.hp} HP`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Top-Right Daily Quests Checklist */}
        <div className="bg-[#18120e]/85 border border-[#4a3b2e] rounded-lg px-3.5 py-2.5 text-xs max-w-[275px]">
          <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-[#3b2f24]">
            <span className="font-bold text-[#e5b95c]">Задания Верховного Гнома</span>
            <span className="font-mono font-bold tabular-nums text-[#f7efe4]">
              {hud.completedQuestsCount}/{hud.minQuestsRequired} мин.
            </span>
          </div>
          <ul className="space-y-1.5">
            {hud.quests.map((q) => (
              <li
                key={q.id}
                className={`flex items-start justify-between gap-2 text-[11px] leading-snug ${
                  q.completed ? 'text-[#7be3b0] line-through opacity-80' : 'text-[#e8ddd0]'
                }`}
              >
                <span>• {q.title}</span>
                <span className="font-mono tabular-nums shrink-0 text-[#c9baa6]">
                  {Math.min(q.currentCount, q.requiredCount)}/{q.requiredCount}
                </span>
              </li>
            ))}
          </ul>
          {hud.completedQuestsCount >= hud.minQuestsRequired && (
            <div className="mt-2 pt-1.5 border-t border-[#3b2f24] text-[11px] font-semibold text-[#7be3b0]">
              Цель дня выполнена! Вернись к Верховному Гному в нору [E]
            </div>
          )}
        </div>
      </div>

      {/* Center Crosshair, Notifications & Prompts */}
      <div className="fixed inset-0 pointer-events-none flex flex-col items-center justify-center">
        {hud.notification && (
          <div className="absolute top-16 px-4 py-2 rounded-lg bg-[#1d1510]/90 border border-[#e5b95c]/60 text-[#fcecd2] text-xs md:text-sm font-medium shadow-md">
            {hud.notification}
          </div>
        )}

        {hud.isGrabbedByHuman && (
          <div className="mb-8 px-4 py-2 rounded-lg bg-[#1d110e]/92 border border-[#d94d3a] text-[#fff2e8] text-xs font-semibold flex flex-col items-center gap-1.5 min-w-[260px]">
            <span>СОСЕД ТАЩИТ К ВЫХОДУ! Жми [Space] или [ЛКМ], чтобы вырваться!</span>
            <div className="w-full h-2 bg-[#2e1a16] rounded overflow-hidden">
              <div
                className="h-full bg-[#f0b44c] transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.round(hud.grabStruggle * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Drone FPV Viewfinder Overlay */}
        {hud.inDroneMode && (
          <div className="fixed inset-6 pointer-events-none border border-[#4ee2ff]/45 rounded-lg">
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-[#0c1d24]/85 border border-[#3aa6c4] text-[11px] font-mono text-[#9ef0ff] flex items-center gap-3">
              <span className="font-bold tracking-wider">MAVIC-GNOME FPV</span>
              <span className="tabular-nums">АКБ: {hud.droneBattery}%</span>
            </div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded bg-[#0c1d24]/85 border border-[#3aa6c4] text-[11px] text-[#d6f8ff]">
              WASD Полёт · Space/C Высота · Shift Спорт · ЛКМ Груз · ПКМ Электрошокер · F Выход
            </div>
          </div>
        )}

        {hud.giantGnomeActive && (
          <div className="mb-4 px-4 py-1.5 rounded-lg bg-[#380e0b]/95 border border-[#ff4d3a] text-[#ffe8e3] text-xs font-bold tracking-wide animate-pulse">
            БОЛЬШОЙ ГНОМ ИДЁТ ЗА ВАМИ! ({hud.giantGnomeDistance} м)
          </div>
        )}

        {hud.inTreeHub && (
          <div className="mb-5 flex flex-col items-center gap-2">
            <div className="px-4 py-1.5 rounded-lg bg-[#162118]/90 border border-[#4fa866] text-[#d6fae0] text-xs font-semibold">
              Дерево с глазами — зайди в дупло и нажми PLAY, чтобы попасть к дому соседа!
            </div>
            {hud.nearPlayButton && (
              <button
                type="button"
                onClick={onDeployFromTree}
                className="pointer-events-auto px-6 py-2.5 rounded-xl bg-[#27b85c] hover:bg-[#32d16c] border-2 border-[#a8ffd0] text-[#082411] text-sm font-extrabold tracking-wider shadow-lg cursor-pointer transition-transform active:scale-95"
              >
                PLAY [E] — ОТПРАВИТЬСЯ К ДОМУ
              </button>
            )}
          </div>
        )}

        {hud.inCarSeat > 0 && (
          <div className="mb-4 px-3.5 py-1.5 rounded-lg bg-[#241612]/90 border border-[#e56847] text-[11px] text-[#fff1eb] flex items-center gap-3">
            <span className="font-bold text-[#ff9d78]">
              МАШИНКА ({hud.inCarSeat === 1 ? 'Водитель' : 'Пассажир'})
            </span>
            <span className="font-mono tabular-nums">Мест: {hud.carSeatsUsed}/2</span>
            <span className="font-mono tabular-nums">Скорость: {hud.carSpeed}</span>
            <span className="text-[#e3c6bc]">
              {hud.inCarSeat === 1 ? 'WASD · Shift Турбо · ЛКМ Гудок · E Выйти' : 'E Выйти'}
            </span>
          </div>
        )}

        {/* Mini-Copter Flight Badge */}
        {hud.inMiniCopter && (
          <div className="mb-4 px-3.5 py-1.5 rounded-lg bg-[#161c22]/90 border border-[#e5b95c]/60 text-[11px] text-[#f7efe4] flex items-center gap-3">
            <span className="font-bold text-[#e5b95c]">МИНИ-КОПТЕР</span>
            <span className="font-mono tabular-nums">Высота: {hud.copterAltitude} м</span>
            <span className="font-mono tabular-nums">Скорость: {hud.copterSpeed}</span>
            <span className="text-[#cbbda9]">Space/C · ЛКМ Крюк · ПКМ Сброс · E Выход</span>
          </div>
        )}

        {/* Crosshair */}
        <div
          className={`w-2 h-2 rounded-full border transition-transform duration-100 ${
            hud.promptText
              ? 'bg-[#e5b95c] border-[#18120e] scale-125'
              : 'bg-white/75 border-black/60'
          }`}
        />

        {hud.promptText && (
          <div className="mt-5 px-3 py-1 rounded bg-[#18120e]/85 border border-[#594737] text-[#f5ebdc] text-xs font-medium">
            {hud.promptText}
          </div>
        )}

        {!hud.pointerLocked && !chatOpen && (
          <div className="mt-3 px-3 py-1 rounded bg-[#a63428]/90 text-[#fff6eb] text-[11px] font-medium">
            Кликни по экрану для обзора мышью (или используй стрелки ← ↑ → ↓)
          </div>
        )}
      </div>

      {/* Bottom Area: Quick Chat (Left, Multiplayer) & Controls Strip (Center) */}
      <div className="relative flex flex-col gap-2">
        {mp && mp.active && (
          <div className="w-72 max-w-[85vw] space-y-1.5">
            {mp.chat.length > 0 && (
              <div className="bg-[#16100c]/75 border border-[#423428] rounded-lg px-2.5 py-1.5 space-y-0.5 text-[11px]">
                {mp.chat.slice(-5).map((m) => {
                  const pal = GNOME_COLOR_PALETTE[m.senderColor] ?? GNOME_COLOR_PALETTE.gold;
                  return (
                    <div key={m.id} className="leading-snug break-words">
                      <span
                        className="font-bold mr-1"
                        style={{ color: m.system ? '#e5b95c' : pal.hex }}
                      >
                        {m.senderName}:
                      </span>
                      <span className={m.system ? 'text-[#d9cbb8] italic' : 'text-[#f5ebdc]'}>
                        {m.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {chatOpen ? (
              <form onSubmit={handleSubmitChat} className="pointer-events-auto flex gap-1.5">
                <input
                  ref={chatInputRef}
                  type="text"
                  maxLength={140}
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  placeholder="Написать отряду (Enter / Esc)..."
                  className="flex-1 px-2.5 py-1.5 rounded bg-[#18120e]/95 border border-[#e5b95c] text-xs text-white focus:outline-none"
                />
              </form>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-[#cbbda9] bg-[#18120e]/75 border border-[#423428] rounded px-2 py-1 w-fit">
                <MessageSquare className="w-3 h-3 text-[#e5b95c]" />
                <span>Нажми [T] для чата</span>
              </div>
            )}
          </div>
        )}

        {/* Bottom Compact Collapsible Control Strip */}
        <div className="flex flex-col items-center gap-1 pointer-events-auto self-center">
          <button
            type="button"
            onClick={() => setControlsCollapsed((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-t bg-[#18120e]/85 border border-b-0 border-[#4a3b2e] text-[10px] text-[#cbbda9] hover:text-white cursor-pointer"
          >
            {controlsCollapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>{controlsCollapsed ? 'Управление' : 'Скрыть'}</span>
          </button>

          {!controlsCollapsed && (
            <div className="flex flex-wrap items-center justify-center gap-3 bg-[#18120e]/85 border border-[#4a3b2e] rounded-lg px-3.5 py-1.5 text-[11px] text-[#d6cab9]">
              <span>WASD Бег</span>
              <span>Shift Рывок</span>
              <span>Space Прыжок / Лазать</span>
              <span>C Присед ({hud.isCrouching ? 'ВКЛ' : 'ВЫКЛ'})</span>
              <span>E Коптер / Взаимод.</span>
              {hud.hasDrone && <span>F Дрон</span>}
              <span>ЛКМ Взять / Палка</span>
              <span>ПКМ Бросить</span>
              <span>Колёсико Дистанция</span>
              <button
                type="button"
                onClick={onToggleMute}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#292019] hover:bg-[#382c22] border border-[#544335] text-[#f5ebdc] cursor-pointer"
              >
                {hud.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={onOpenPause}
                className="px-2 py-0.5 rounded bg-[#292019] hover:bg-[#382c22] border border-[#544335] text-[#f5ebdc] cursor-pointer"
              >
                Пауза (Esc)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
