/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { GameModals } from './components/GameModals';
import { HUD } from './components/HUD';
import { TitleScreen } from './components/TitleScreen';
import { WorkbenchModal } from './components/WorkbenchModal';
import { GameEngine } from './game/GameEngine';
import { CraftUpgrades, GameScreen, GnomeColorId, HudSnapshot } from './types/game';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [screen, setScreen] = useState<GameScreen>('title');
  const [hud, setHud] = useState<HudSnapshot | null>(null);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new GameEngine(
      container,
      (snapshot) => setHud(snapshot),
      (nextScreen) => setScreen(nextScreen)
    );
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleStartSolo = (startDay: number) => {
    engineRef.current?.startNewGame(startDay);
  };

  const handleCreateServer = async (params: {
    playerName: string;
    color: GnomeColorId;
    serverName: string;
    isPublic: boolean;
    startDay: number;
  }) => {
    if (!engineRef.current) return;
    await engineRef.current.createMultiplayerServer(params);
  };

  const handleJoinServer = async (params: {
    code: string;
    playerName: string;
    color: GnomeColorId;
  }) => {
    if (!engineRef.current) return;
    await engineRef.current.joinMultiplayerServer(params);
  };

  const handleCraft = (item: keyof CraftUpgrades) => {
    engineRef.current?.craftItem(item);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#16110d]">
      {/* Isolated WebGL canvas mount container */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {screen === 'title' && (
        <TitleScreen
          onStartSolo={handleStartSolo}
          onCreateServer={handleCreateServer}
          onJoinServer={handleJoinServer}
        />
      )}

      {screen === 'playing' && hud && (
        <HUD
          hud={hud}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onOpenPause={() => engineRef.current?.setScreen('paused')}
          onSendChat={(text) => engineRef.current?.sendChatMessage(text)}
          onChatTypingChange={(typing) => engineRef.current?.setChatTyping(typing)}
          onDeployFromTree={() => engineRef.current?.deployFromTreehouse()}
        />
      )}

      {screen === 'workbench' && hud && (
        <WorkbenchModal
          hud={hud}
          onCraft={handleCraft}
          onClose={() => engineRef.current?.setScreen('playing')}
        />
      )}

      {(screen === 'paused' || screen === 'highgnome' || screen === 'summary') && hud && (
        <GameModals
          screen={screen}
          hud={hud}
          onResume={() => engineRef.current?.setScreen('playing')}
          onExtract={() => engineRef.current?.extractEarly()}
          onNextDay={() => engineRef.current?.startNextDay()}
          onRetryDay={() => engineRef.current?.retryCurrentDay()}
          onLeaveServer={() => engineRef.current?.leaveServer()}
        />
      )}
    </div>
  );
}
