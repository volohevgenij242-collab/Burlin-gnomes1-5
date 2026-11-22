import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe,
  Lock,
  Plus,
  RefreshCw,
  Users,
  KeyRound,
  User,
  Home,
  ChevronLeft,
  ChevronRight,
  Shuffle,
} from 'lucide-react';
import { getHouseBlueprint, HOUSES_COUNT } from '../game/houses';
import { GNOME_COLOR_PALETTE } from '../game/models';
import { fetchPublicServers } from '../game/multiplayer';
import { GnomeColorId, ServerListing } from '../types/game';

interface TitleScreenProps {
  onStartSolo: (startDay: number) => void;
  onCreateServer: (params: {
    playerName: string;
    color: GnomeColorId;
    serverName: string;
    isPublic: boolean;
    startDay: number;
  }) => Promise<void>;
  onJoinServer: (params: {
    code: string;
    playerName: string;
    color: GnomeColorId;
  }) => Promise<void>;
}

const COLOR_IDS: GnomeColorId[] = ['red', 'blue', 'green', 'gold', 'purple', 'teal'];

export const TitleScreen: React.FC<TitleScreenProps> = ({
  onStartSolo,
  onCreateServer,
  onJoinServer,
}) => {
  const [playerName, setPlayerName] = useState('Ворчун');
  const [color, setColor] = useState<GnomeColorId>('red');
  const [startDay, setStartDay] = useState(1);

  const [joinCode, setJoinCode] = useState('');
  const [serverName, setServerName] = useState('Нора Братвы');
  const [isPublic, setIsPublic] = useState(true);
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedHouse = getHouseBlueprint(startDay);

  const loadServers = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await fetchPublicServers();
      setServers(list);
    } catch {
      // ignore transient poll error
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
    const timer = window.setInterval(() => {
      void loadServers();
    }, 4000);
    return () => clearInterval(timer);
  }, [loadServers]);

  const handleJoinByCode = async (codeOverride?: string) => {
    const code = (codeOverride ?? joinCode).trim().toUpperCase();
    if (!code) {
      setErrorMsg('Введи код сервера (например: K7P2M)');
      return;
    }
    setErrorMsg(null);
    setBusyAction(true);
    try {
      await onJoinServer({
        code,
        playerName: playerName.trim() || 'Гном',
        color,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось подключиться');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreate = async () => {
    setErrorMsg(null);
    setBusyAction(true);
    try {
      await onCreateServer({
        playerName: playerName.trim() || 'Гном',
        color,
        serverName: serverName.trim() || 'Тайная Нора',
        isPublic,
        startDay,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось создать сервер');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-between p-6 md:p-10 pointer-events-auto bg-gradient-to-r from-[#140f0c]/90 via-[#140f0c]/65 to-[#140f0c]/40 overflow-y-auto">
      <div className="my-auto max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Title, Profile & Solo Launch */}
        <div className="lg:col-span-5 space-y-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <svg
                width="42"
                height="42"
                viewBox="0 0 48 48"
                fill="none"
                className="shrink-0"
                aria-hidden="true"
              >
                <path d="M24 4L10 34H38L24 4Z" fill="#B53328" stroke="#E5B95C" strokeWidth="2.2" />
                <ellipse cx="24" cy="34" rx="16" ry="4.5" fill="#8C231A" stroke="#E5B95C" strokeWidth="2" />
                <path d="M16 37C17 42 20 45 24 45C28 45 31 42 32 37" fill="#EFEAE0" />
                <circle cx="24" cy="35" r="3" fill="#E39D7E" />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#e5b95c]">
                Кооперативный стелс · 15 см масштаб
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-[#f7efe4] leading-[1.02] drop-shadow-md">
              BURGLIN&apos; GNOMES
            </h1>
            <p className="mt-3 text-sm md:text-base text-[#d6cab9] leading-relaxed">
              Играй один или соберите банду до 6 гномов на сервере по коду! 100 разных домов,
              более 30 заданий, паркур по мебели и сосед с оружием.
            </p>
          </div>

          {/* House Selector (1..100) */}
          <div className="bg-[#1b140f]/90 border border-[#4d3d30] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e5b95c]">
                <Home className="w-3.5 h-3.5" />
                <span>Стартовый дом (1–{HOUSES_COUNT})</span>
              </div>
              <button
                type="button"
                onClick={() => setStartDay(1 + Math.floor(Math.random() * HOUSES_COUNT))}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#292019] hover:bg-[#382c22] border border-[#544335] text-[11px] text-[#f5ebdc] cursor-pointer"
              >
                <Shuffle className="w-3 h-3 text-[#e5b95c]" />
                <span>Случайный</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStartDay((d) => (d <= 1 ? HOUSES_COUNT : d - 1))}
                className="p-1.5 rounded-lg bg-[#120d0a] hover:bg-[#292019] border border-[#4d3d30] text-[#e5d9c8] cursor-pointer"
                aria-label="Предыдущий дом"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="range"
                min={1}
                max={HOUSES_COUNT}
                value={startDay}
                onChange={(e) => setStartDay(Number(e.target.value))}
                className="flex-1 accent-[#e5b95c] cursor-pointer"
              />
              <span className="font-mono font-bold text-xs text-[#e5b95c] w-12 text-center tabular-nums">
                #{startDay}
              </span>
              <button
                type="button"
                onClick={() => setStartDay((d) => (d >= HOUSES_COUNT ? 1 : d + 1))}
                className="p-1.5 rounded-lg bg-[#120d0a] hover:bg-[#292019] border border-[#4d3d30] text-[#e5d9c8] cursor-pointer"
                aria-label="Следующий дом"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#120d0a] border border-[#3a2e24] rounded-lg px-3 py-2 space-y-0.5">
              <div className="text-xs font-bold text-[#f7efe4] truncate">{selectedHouse.name}</div>
              <div className="text-[11px] text-[#b8aa96] truncate">
                {selectedHouse.district} · {selectedHouse.mood.label} · {selectedHouse.layoutName}
              </div>
            </div>
          </div>

          {/* Gnome Profile */}
          <div className="bg-[#1b140f]/90 border border-[#4d3d30] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e5b95c]">
              <User className="w-3.5 h-3.5" />
              <span>Твой гном</span>
            </div>

            <div>
              <label className="block text-[11px] text-[#c7b9a6] mb-1">Имя гнома</label>
              <input
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Введи имя..."
                className="w-full px-3 py-2 rounded-lg bg-[#120d0a] border border-[#4d3d30] text-sm text-[#f7efe4] focus:outline-none focus:border-[#e5b95c]"
              />
            </div>

            <div>
              <span className="block text-[11px] text-[#c7b9a6] mb-1.5">Цвет колпака</span>
              <div className="flex flex-wrap gap-2">
                {COLOR_IDS.map((cid) => {
                  const pal = GNOME_COLOR_PALETTE[cid];
                  const active = color === cid;
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => setColor(cid)}
                      title={pal.label}
                      className={`w-8 h-8 rounded-lg border-2 transition cursor-pointer flex items-center justify-center ${
                        active ? 'border-[#f7efe4] scale-110 shadow-md' : 'border-transparent opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: pal.hex }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={busyAction}
            onClick={() => onStartSolo(startDay)}
            className="w-full px-6 py-3.5 rounded-xl bg-[#c43a2d] hover:bg-[#d64536] active:scale-[0.99] text-[#fff8ee] font-bold text-base tracking-wide shadow-lg border border-[#e5b95c]/50 transition cursor-pointer"
          >
            Одиночная вылазка (Дом #{startDay})
          </button>
        </div>

        {/* Right Column: Multiplayer Code Join, Create Server & Public Server List */}
        <div className="lg:col-span-7 bg-[#1b140f]/92 border border-[#544335] rounded-2xl p-5 space-y-5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#3d3025] pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#e5b95c]" />
              <h2 className="text-lg font-extrabold text-[#f7efe4]">Мультиплеер · Серверы по коду</h2>
            </div>
            <span className="text-xs text-[#a89a87]">До {6} гномов в комнате</span>
          </div>

          {errorMsg && (
            <div className="px-3.5 py-2.5 rounded-lg bg-[#6b1f19]/85 border border-[#c94b3e] text-[#ffd7d2] text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Join by Code */}
          <div className="bg-[#130e0b] border border-[#3d3025] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e5b95c]">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Войти на сервер по коду</span>
            </div>
            <div className="flex gap-2.5">
              <input
                type="text"
                maxLength={8}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleJoinByCode();
                }}
                placeholder="Код (например K7P2M)"
                className="flex-1 px-3.5 py-2.5 rounded-lg bg-[#1d1510] border border-[#4d3d30] text-sm font-mono uppercase tracking-[0.2em] text-[#f7efe4] placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:border-[#e5b95c]"
              />
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleJoinByCode()}
                className="px-5 py-2.5 rounded-lg bg-[#2f7d52] hover:bg-[#389462] disabled:opacity-50 text-white font-bold text-sm transition cursor-pointer shrink-0"
              >
                Войти по коду
              </button>
            </div>
          </div>

          {/* Create Server */}
          <div className="bg-[#130e0b] border border-[#3d3025] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e5b95c]">
              <Plus className="w-3.5 h-3.5" />
              <span>Создать свой сервер</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                maxLength={24}
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Название сервера..."
                className="flex-1 px-3.5 py-2 rounded-lg bg-[#1d1510] border border-[#4d3d30] text-sm text-[#f7efe4] focus:outline-none focus:border-[#e5b95c]"
              />
              <button
                type="button"
                onClick={() => setIsPublic((v) => !v)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#261d17] border border-[#4d3d30] text-xs font-semibold text-[#e5d9c8] hover:bg-[#32261e] cursor-pointer shrink-0"
              >
                {isPublic ? (
                  <>
                    <Globe className="w-3.5 h-3.5 text-[#7be3b0]" />
                    <span>Открытый</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 text-[#f2bc57]" />
                    <span>Только по коду</span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleCreate()}
                className="px-4 py-2 rounded-lg bg-[#c43a2d] hover:bg-[#d64536] disabled:opacity-50 text-white font-bold text-sm transition cursor-pointer shrink-0"
              >
                Создать
              </button>
            </div>
          </div>

          {/* Active Public Servers List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#c7b9a6]">
                Открытые серверы ({servers.length})
              </span>
              <button
                type="button"
                onClick={() => void loadServers()}
                className="flex items-center gap-1 text-xs text-[#e5b95c] hover:text-[#f7d279] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
                <span>Обновить</span>
              </button>
            </div>

            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              {servers.length === 0 ? (
                <div className="text-xs text-[#8e8070] bg-[#130e0b] border border-[#33271e] rounded-lg px-3.5 py-4 text-center">
                  Сейчас нет открытых серверов. Создай свой и позови друзей по коду!
                </div>
              ) : (
                servers.map((srv) => (
                  <div
                    key={srv.code}
                    className="flex items-center justify-between gap-3 bg-[#130e0b] border border-[#3d3025] rounded-lg px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#f7efe4] truncate">{srv.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-[#2a2119] border border-[#544335] font-mono text-[11px] font-bold text-[#e5b95c]">
                          {srv.code}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#a89a87] truncate">
                        Хост: {srv.hostName} · День {srv.day}{srv.houseName ? ` · ${srv.houseName}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-mono font-bold text-[#cbbda9]">
                        {srv.playerCount}/{srv.maxPlayers}
                      </span>
                      <button
                        type="button"
                        disabled={busyAction || srv.playerCount >= srv.maxPlayers}
                        onClick={() => void handleJoinByCode(srv.code)}
                        className="px-3 py-1.5 rounded-lg bg-[#2f7d52] hover:bg-[#389462] disabled:bg-[#302822] disabled:text-[#786b5e] text-white text-xs font-bold cursor-pointer"
                      >
                        Войти
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="text-xs text-[#c4b8a6] bg-[#16110d]/85 border border-[#4a3b2e] rounded-lg px-4 py-2 w-fit mx-auto mt-4">
        WASD Движение · Space Прыжок / Карабкаться · C Красться · ЛКМ Взять / Бить · ПКМ Бросить · E Верстак / Гном · T Чат
      </div>
    </div>
  );
};
