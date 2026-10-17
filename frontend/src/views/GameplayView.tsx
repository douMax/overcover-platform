import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameState } from "../hooks/useGameState";
import { useSocket } from "../hooks/useSocket";
import { DesertButton } from "../components/DesertButton";
import { Avatar } from "../components/Avatar";
import { PlayerRole } from "@shared/types/player";
import { UndercoverGameStateDTO, TaskWolfGameStateDTO, ColourHuntGameStateDTO } from "@shared/types/game-state";
import { BluffKingView } from "./BluffKingView";
import { FeedbackBar } from "../components/FeedbackBar";

// Shared types for both game modes
interface GameInfo {
  type: 'UNDERCOVER' | 'TASKWOLF';
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  round: number;
  votedPlayerIds: string[];
  myVoteTarget?: string;
  revealedVotes?: Record<string, string>;
  eliminatedPlayerIds: string[];
  winner?: string;
  // What the current player sees:
  mySecret?: string;        // word or task
  mySecretLabel: string;    // "你的词语" or "你的任务"
  myRole?: PlayerRole;
  // God view:
  allRoles?: Record<string, PlayerRole>;
  allSecrets?: Record<string, string>;
  secretLabel: string;      // "词语" or "任务"
}

function extractGameInfo(gs: UndercoverGameStateDTO | TaskWolfGameStateDTO): GameInfo {
  if (gs.type === 'UNDERCOVER') {
    const u = gs as UndercoverGameStateDTO;
    return {
      type: 'UNDERCOVER',
      phase: u.phase, round: u.round,
      votedPlayerIds: u.votedPlayerIds,
      myVoteTarget: u.myVoteTarget,
      revealedVotes: u.revealedVotes,
      eliminatedPlayerIds: u.eliminatedPlayerIds,
      winner: u.winner,
      mySecret: u.myWord,
      mySecretLabel: "你的词语（长按查看）",
      myRole: u.myRole,
      allRoles: u.allRoles,
      allSecrets: u.allWords,
      secretLabel: "词语",
    };
  } else {
    const t = gs as TaskWolfGameStateDTO;
    return {
      type: 'TASKWOLF',
      phase: t.phase, round: t.round,
      votedPlayerIds: t.votedPlayerIds,
      myVoteTarget: t.myVoteTarget,
      revealedVotes: t.revealedVotes,
      eliminatedPlayerIds: t.eliminatedPlayerIds,
      winner: t.winner,
      mySecret: t.myTask,
      mySecretLabel: "你的任务（长按查看）",
      myRole: t.myRole,
      allRoles: t.allRoles,
      allSecrets: t.allTasks,
      secretLabel: "任务",
    };
  }
}

function getRoleName(role: PlayerRole | undefined, gameType: string): string {
  if (!role) return "未知";
  if (gameType === 'UNDERCOVER') {
    return role === PlayerRole.CIVILIAN ? "平民" : role === PlayerRole.UNDERCOVER ? "卧底" : role;
  } else {
    return role === PlayerRole.VILLAGER ? "村民" : role === PlayerRole.WOLF ? "狼人" : role;
  }
}

function getBadRole(gameType: string): PlayerRole {
  return gameType === 'UNDERCOVER' ? PlayerRole.UNDERCOVER : PlayerRole.WOLF;
}

function getWinnerText(winner: string | undefined, gameType: string): { text: string; color: string } {
  if (!winner) return { text: "", color: "" };
  if (gameType === 'UNDERCOVER') {
    return winner === "CIVILIAN"
      ? { text: "平民胜利!", color: "text-secondary" }
      : { text: "卧底胜利!", color: "text-error" };
  } else {
    return winner === "VILLAGER"
      ? { text: "村民胜利!", color: "text-secondary" }
      : { text: "狼人胜利!", color: "text-error" };
  }
}

export function GameplayView() {
  const navigate = useNavigate();
  const { room, currentPlayer, isHost, players, gameState } = useGameState();
  const {
    submitVote, revealVotes, eliminatePlayer,
    nextRound, skipEliminate, endGame, restartGame,
    voteWarning, clearVoteWarning,
  } = useSocket();

  const [secretRevealed, setSecretRevealed] = useState(false);
  const [holdTimer, setHoldTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = () => {
    const timer = setTimeout(() => {
      setSecretRevealed(true);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 300);
    setHoldTimer(timer);
  };

  const handleTouchEnd = () => {
    if (holdTimer) clearTimeout(holdTimer);
    setHoldTimer(null);
    setSecretRevealed(false);
  };

  if (!room || !currentPlayer || !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-on-surface">加载中...</div>
      </div>
    );
  }

  if (gameState.type === 'BLUFF_KING') {
    return <BluffKingView gameState={gameState} />;
  }

  // Colour Hunt has its own UI
  if ((gameState as ColourHuntGameStateDTO).type === 'COLOUR_HUNT') {
    const ch = gameState as ColourHuntGameStateDTO;
    const isResultPhase = ch.phase === 'RESULT';

    return (
      <div className="min-h-screen p-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold font-display text-on-surface mb-2">
              {isResultPhase ? "所有人的颜色" : "野餐 Colour Hunt"}
            </h2>
            <p className="text-on-surface-variant">
              {isResultPhase ? "看看大家都要带什么颜色的零食吧!" : "长按查看你分配到的颜色"}
            </p>
          </div>

          {/* My colour card */}
          {!isResultPhase && ch.myColour && (
            <div className="glass rounded-lg p-6 mb-6">
              <div className="text-sm text-on-surface-variant mb-3">你的颜色（长按查看）</div>
              <div
                className="select-none cursor-pointer"
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onMouseLeave={handleTouchEnd}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div className={`rounded-xl p-6 text-center transition-all ${secretRevealed ? "" : "blur-lg"}`}
                  style={{ backgroundColor: ch.myColour.hex }}>
                  <div className="text-3xl font-bold font-display mb-2"
                    style={{ color: ['#F5F5F5', '#EAB308'].includes(ch.myColour.hex) ? '#1F2937' : '#FFFFFF' }}>
                    {ch.myColour.name}
                  </div>
                </div>
                {secretRevealed && ch.myColour && (
                  <div className="mt-3 text-center text-on-surface-variant text-sm">
                    零食参考: {ch.myColour.snackHint}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Result: show all colours */}
          {isResultPhase && ch.allColours && (
            <div className="space-y-3 mb-6">
              {players.filter(p => p.isPlaying).map(player => {
                const colour = ch.allColours![player.id];
                if (!colour) return null;
                const isLight = ['#F5F5F5', '#EAB308'].includes(colour.hex);
                return (
                  <div key={player.id} className="rounded-xl overflow-hidden border border-outline-variant/60">
                    <div className="p-4 flex items-center gap-4" style={{ backgroundColor: colour.hex }}>
                      <Avatar avatar={player.avatar} size="sm" />
                      <div>
                        <div className="font-bold text-lg" style={{ color: isLight ? '#1F2937' : '#FFFFFF' }}>
                          {player.nickname}
                          {player.id === currentPlayer?.id && (
                            <span className="text-xs ml-2 opacity-75">(我)</span>
                          )}
                        </div>
                        <div className="text-sm" style={{ color: isLight ? '#374151' : '#E5E7EB' }}>
                          {colour.name}
                        </div>
                      </div>
                    </div>
                    <div className="bg-surface-container-low px-4 py-2 text-xs text-on-surface-variant">
                      零食参考: {colour.snackHint}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Host controls */}
          {isHost && (
            <div className="glass rounded-lg p-4 mb-6">
              <div className="text-sm text-on-surface-variant mb-3">房主控制</div>
              <div className="flex gap-3 flex-wrap">
                {!isResultPhase && (
                  <DesertButton variant="primary" onClick={() => endGame()}>
                    揭晓所有颜色
                  </DesertButton>
                )}
                {isResultPhase && (
                  <DesertButton variant="primary" onClick={restartGame}>
                    再来一局
                  </DesertButton>
                )}
                <DesertButton variant="tertiary" onClick={() => navigate("/")}>
                  返回大厅
                </DesertButton>
              </div>
            </div>
          )}

          {/* Players list (playing phase) */}
          {!isResultPhase && (
            <div className="glass rounded-lg p-6">
              <h3 className="text-xl font-bold font-display text-on-surface mb-4">
                参与者 ({players.filter(p => p.isPlaying).length})
              </h3>
              <div className="space-y-3">
                {players.filter(p => p.isPlaying).map(player => (
                  <div key={player.id} className="bg-surface-container/60 rounded-lg p-4 flex items-center gap-3">
                    <Avatar avatar={player.avatar} size="sm" />
                    <div className="font-bold text-on-surface">
                      {player.nickname}
                      {player.id === currentPlayer?.id && <span className="text-xs text-on-surface-variant ml-2">(我)</span>}
                      {player.isHost && <span className="text-xs text-secondary ml-2">房主</span>}
                    </div>
                    <span className="ml-auto text-sm text-on-surface-variant">已抽签</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const gi = extractGameInfo(gameState as UndercoverGameStateDTO | TaskWolfGameStateDTO);
  const isPlaying = currentPlayer.isPlaying;
  const isAlive = currentPlayer.isAlive && !gi.eliminatedPlayerIds.includes(currentPlayer.id);
  const isEliminated = gi.eliminatedPlayerIds.includes(currentPlayer.id);
  const hasGodView = isHost && !!gi.allRoles;
  const badRole = getBadRole(gi.type);

  const alivePlayers = players.filter(
    p => p.isPlaying && p.isAlive && !gi.eliminatedPlayerIds.includes(p.id)
  );

  const handleBackToLobby = () => {
    if (window.confirm("确定要回到游戏大厅吗？你可以通过房间号重新加入。")) {
      navigate("/");
    }
  };

  const getVoteTally = (): Map<string, { count: number; voters: string[] }> => {
    const tally = new Map<string, { count: number; voters: string[] }>();
    if (!gi.revealedVotes) return tally;
    for (const [voterId, targetId] of Object.entries(gi.revealedVotes)) {
      const entry = tally.get(targetId) || { count: 0, voters: [] };
      entry.count += 1;
      entry.voters.push(voterId);
      tally.set(targetId, entry);
    }
    return tally;
  };

  const getPlayerName = (id: string): string =>
    players.find(p => p.id === id)?.nickname || id;

  // RESULT phase
  if (gi.phase === "RESULT") {
    const winInfo = getWinnerText(gi.winner, gi.type);
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-2xl mx-auto">
          <div className="glass rounded-lg p-6 mb-6 text-center shadow-glow">
            <h2 className="text-3xl font-bold font-display text-on-surface mb-2">游戏结束</h2>
            {gi.winner && (
              <div className={`text-2xl font-bold font-display mt-4 ${winInfo.color}`}>
                {winInfo.text}
              </div>
            )}
            {gameState.type === 'UNDERCOVER' && gameState.canRate && (
              <div className="mt-4 text-left">
                <FeedbackBar />
              </div>
            )}
          </div>

          <div className="glass rounded-lg p-6">
            <h3 className="text-xl font-bold font-display text-on-surface mb-4">所有身份</h3>
            <div className="space-y-3">
              {players.filter(p => p.isPlaying).map(player => {
                const role = gi.allRoles?.[player.id];
                const secret = gi.allSecrets?.[player.id];
                const wasEliminated = gi.eliminatedPlayerIds.includes(player.id);
                return (
                  <div key={player.id} className="bg-surface-container/60 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar avatar={player.avatar} size="sm" />
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface-container ${player.isConnected ? "bg-tertiary shadow-neon-green" : "bg-outline"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-on-surface">
                          {player.nickname}
                          {player.isHost && <span className="text-xs text-secondary ml-2">房主</span>}
                          {wasEliminated && <span className="text-xs text-on-surface-variant ml-2">已淘汰</span>}
                        </div>
                        <div className="text-sm mt-1">
                          <span className={role === badRole ? "text-error" : "text-secondary"}>
                            {getRoleName(role, gi.type)}
                          </span>
                          {secret && (
                            <span className="text-on-surface-variant ml-2">
                              {gi.secretLabel}: {secret}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex justify-center gap-4">
            {isHost && (
              <DesertButton variant="primary" onClick={restartGame}>
                再来一局
              </DesertButton>
            )}
            <DesertButton variant="tertiary" onClick={() => navigate("/")}>
              返回大厅
            </DesertButton>
          </div>
        </div>
      </div>
    );
  }

  const voteTally = getVoteTally();

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={handleBackToLobby} className="text-sm text-on-surface-variant hover:text-on-surface">
            ← 游戏大厅
          </button>
          <span className="text-on-surface-variant text-lg font-display">第 {gi.round} 轮</span>
          <div className="w-16" />
        </div>

        {/* Secret card (word or task, hold to reveal) */}
        {isPlaying && gi.mySecret !== undefined && (
          <div className="glass rounded-lg p-6 mb-6 neon-border">
            <div className="text-sm text-on-surface-variant mb-2">{gi.mySecretLabel}</div>
            <div
              className="select-none cursor-pointer"
              onMouseDown={handleTouchStart}
              onMouseUp={handleTouchEnd}
              onMouseLeave={handleTouchEnd}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className={`text-2xl font-bold text-on-surface text-center py-4 rounded-lg transition-all ${secretRevealed ? "" : "blur-lg"}`}>
                {gi.mySecret || "空白卡 (无词语)"}
              </div>
            </div>
            {isEliminated && (
              <div className="text-error text-sm text-center mt-2">你已被淘汰</div>
            )}
          </div>
        )}

        {/* Role display for villagers in TaskWolf (no task, just role) */}
        {isPlaying && gi.type === 'TASKWOLF' && gi.mySecret === undefined && gi.myRole && (
          <div className="glass rounded-lg p-6 mb-6 neon-border-cyan text-center">
            <div className="text-sm text-on-surface-variant mb-2">你的身份</div>
            <div className="text-2xl font-bold font-display text-secondary">
              {getRoleName(gi.myRole, gi.type)}
            </div>
            {isEliminated && (
              <div className="text-error text-sm mt-2">你已被淘汰</div>
            )}
          </div>
        )}

        {/* God view */}
        {hasGodView && gi.phase === "PLAYING" && (
          <div className="bg-warning/10 rounded-lg p-4 mb-6 border border-warning/30">
            <div className="text-warning text-sm font-bold mb-2">上帝视角</div>
            <div className="space-y-1">
              {players.filter(p => p.isPlaying).map(player => (
                <div key={player.id} className="text-sm flex gap-2">
                  <span className="text-on-surface-variant">{player.nickname}:</span>
                  <span className={gi.allRoles?.[player.id] === badRole ? "text-error" : "text-secondary"}>
                    {getRoleName(gi.allRoles?.[player.id], gi.type)}
                  </span>
                  {gi.allSecrets?.[player.id] && (
                    <span className="text-outline">— {gi.allSecrets[player.id]}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vote warning */}
        {voteWarning && (
          <div className="bg-warning/15 rounded-lg p-4 mb-6 border border-warning/40">
            <div className="text-warning font-bold mb-2">
              还有 {voteWarning.notVoted.length} 人未投票
            </div>
            <div className="text-on-surface-variant text-sm mb-3">
              未投票: {voteWarning.notVoted.map(id => getPlayerName(id)).join("、")}
            </div>
            <div className="flex gap-3">
              <DesertButton variant="primary" onClick={() => revealVotes(true)}>仍然揭晓</DesertButton>
              <DesertButton variant="tertiary" onClick={clearVoteWarning}>继续等待</DesertButton>
            </div>
          </div>
        )}

        {/* Win condition banner */}
        {gi.winner && isHost && (
          <div className="bg-tertiary/10 rounded-lg p-4 mb-6 text-center border border-tertiary/40">
            <div className="text-tertiary font-bold mb-2">
              检测到游戏结束: {getWinnerText(gi.winner, gi.type).text}
            </div>
            <DesertButton variant="primary" onClick={() => endGame(gi.winner)}>宣布结果</DesertButton>
          </div>
        )}

        {/* Host controls */}
        {isHost && (
          <div className="glass rounded-lg p-4 mb-6">
            <div className="text-sm text-on-surface-variant mb-3">房主控制</div>
            {gi.phase === "PLAYING" && (
              <div className="flex gap-3 flex-wrap">
                <DesertButton variant="primary" onClick={() => revealVotes()}>揭晓投票</DesertButton>
                <DesertButton variant="tertiary" onClick={() => endGame()}>结束游戏</DesertButton>
              </div>
            )}
            {gi.phase === "REVEAL" && (
              <div className="flex gap-3 flex-wrap">
                <DesertButton variant="tertiary" onClick={skipEliminate}>不淘汰，下一轮</DesertButton>
                <DesertButton variant="tertiary" onClick={() => endGame()}>结束游戏</DesertButton>
              </div>
            )}
          </div>
        )}

        {/* Players list */}
        <div className="glass rounded-lg p-6">
          <h3 className="text-xl font-bold font-display text-on-surface mb-4">
            玩家 ({alivePlayers.length} 存活 / {players.filter(p => p.isPlaying).length} 总计)
          </h3>
          <div className="space-y-3">
            {players.filter(p => p.isPlaying).map(player => {
              const isPlayerEliminated = gi.eliminatedPlayerIds.includes(player.id);
              const isMyVoteTarget = gi.myVoteTarget === player.id;
              const hasVoted = gi.votedPlayerIds.includes(player.id);
              const canVoteForThis =
                gi.phase === "PLAYING" && isAlive && !isPlayerEliminated &&
                player.id !== currentPlayer.id && isPlaying;
              const tallyEntry = voteTally.get(player.id);

              return (
                <div
                  key={player.id}
                  onClick={() => canVoteForThis && submitVote(player.id)}
                  className={`rounded-lg p-4 transition-all ${
                    isPlayerEliminated ? "bg-surface-container/30 opacity-50"
                    : isMyVoteTarget ? "bg-error/15 border border-error/60 shadow-[0_0_12px_rgba(255,23,68,0.2)]"
                    : canVoteForThis ? "bg-surface-container/60 cursor-pointer active:bg-surface-container-high/80 hover:border-primary/30 border border-transparent"
                    : "bg-surface-container/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar avatar={player.avatar} size="sm" />
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface-container ${player.isConnected ? "bg-tertiary shadow-neon-green" : "bg-outline"}`} />
                      </div>
                      <div>
                        <div className={`font-bold ${isPlayerEliminated ? "text-outline line-through" : "text-on-surface"}`}>
                          {player.nickname}
                          {player.id === currentPlayer.id && <span className="text-xs text-on-surface-variant ml-2">(我)</span>}
                          {player.isHost && <span className="text-xs text-secondary ml-2">房主</span>}
                        </div>
                        {isPlayerEliminated && <div className="text-xs text-outline">已淘汰</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {gi.phase === "PLAYING" && hasVoted && !isPlayerEliminated && (
                        <span className="text-xs text-tertiary">已投票</span>
                      )}
                      {isMyVoteTarget && gi.phase === "PLAYING" && (
                        <span className="text-xs text-error font-bold">你的投票</span>
                      )}
                      {gi.phase === "REVEAL" && tallyEntry && (
                        <span className="text-sm text-warning font-bold">{tallyEntry.count} 票</span>
                      )}
                      {isHost && gi.phase === "REVEAL" && !isPlayerEliminated && (
                        <button
                          onClick={(e) => { e.stopPropagation(); eliminatePlayer(player.id); }}
                          className="px-2 py-1 bg-error hover:bg-error/90 text-on-error rounded text-xs font-bold shadow-[0_0_8px_rgba(255,23,68,0.3)]"
                        >
                          淘汰
                        </button>
                      )}
                    </div>
                  </div>
                  {gi.phase === "REVEAL" && tallyEntry && (
                    <div className="mt-2 text-xs text-on-surface-variant">
                      投票者: {tallyEntry.voters.map(id => getPlayerName(id)).join("、")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
