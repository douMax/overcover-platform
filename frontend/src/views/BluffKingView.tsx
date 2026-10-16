import { ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameState } from "../hooks/useGameState";
import { useSocket } from "../hooks/useSocket";
import { DesertButton } from "../components/DesertButton";
import { Avatar } from "../components/Avatar";
import { BluffKingGameStateDTO, BluffMode, BluffRole } from "@shared/types/game-state";
import { PlayerDTO } from "@shared/types/player";

const HONEST_VIEW_BUDGET_MS = 10_000;
const HOLD_DELAY_MS = 300;

const ROLE_INFO: Record<BluffRole, { title: string; desc: string; color: string }> = {
  HONEST: { title: "老实人", desc: "你知道真正的解释。讲真话，让猜词人相信你！", color: "text-secondary" },
  BLUFFER: { title: "瞎掰王", desc: "你只知道一部分。一本正经地编，骗到越多票越好！", color: "text-primary" },
  GUESSER: { title: "猜词人", desc: "认真听每个人的解释，投票选出你认为的老实人。", color: "text-tertiary" },
};

const MODE_LABEL: Record<BluffMode, string> = {
  HALF: "前半段",
  HINTS: "三选一",
};

/** Press-and-hold to reveal; reports hold state so callers can meter viewing time */
function HoldToReveal({
  revealed,
  onHoldChange,
  disabled = false,
  children,
}: {
  revealed: boolean;
  onHoldChange: (holding: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (disabled) return;
    timerRef.current = setTimeout(() => {
      onHoldChange(true);
      if (navigator.vibrate) navigator.vibrate(50);
    }, HOLD_DELAY_MS);
  };
  const end = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    onHoldChange(false);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      className="select-none cursor-pointer"
      onMouseDown={start}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchEnd={end}
      onContextMenu={e => e.preventDefault()}
    >
      <div className={`transition-all ${revealed ? "" : "blur-lg"}`}>{children}</div>
    </div>
  );
}

/** Honest player's explanation, viewable for a limited total time per round */
function HonestCard({ explanation, locked, onExpire }: {
  explanation?: string;
  locked: boolean;
  onExpire: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [usedMs, setUsedMs] = useState(0);
  const holdStartRef = useRef<number | null>(null);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const commitHold = () => {
    if (holdStartRef.current === null) return;
    const elapsed = Date.now() - holdStartRef.current;
    holdStartRef.current = null;
    setUsedMs(prev => Math.min(HONEST_VIEW_BUDGET_MS, prev + elapsed));
  };

  const handleHoldChange = (holding: boolean) => {
    if (holding && !expiredRef.current) {
      holdStartRef.current = Date.now();
      setRevealed(true);
    } else {
      commitHold();
      setRevealed(false);
    }
  };

  // Tick while holding so the countdown updates and the card locks on time
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!revealed) return;
    const id = setInterval(() => {
      const holdStart = holdStartRef.current;
      if (holdStart !== null && usedMs + (Date.now() - holdStart) >= HONEST_VIEW_BUDGET_MS) {
        commitHold();
        setRevealed(false);
        if (!expiredRef.current) {
          expiredRef.current = true;
          onExpireRef.current();
        }
      }
      setTick(t => t + 1);
    }, 100);
    return () => clearInterval(id);
  }, [revealed, usedMs]);

  const liveUsed = usedMs + (holdStartRef.current !== null ? Date.now() - holdStartRef.current : 0);
  const remaining = Math.max(0, HONEST_VIEW_BUDGET_MS - liveUsed);

  if (locked || !explanation) {
    return (
      <div className="rounded-lg bg-surface-container/60 p-4 text-center text-on-surface-variant text-sm">
        查看时间已用完，凭记忆讲吧 🤫
      </div>
    );
  }

  return (
    <div>
      <HoldToReveal revealed={revealed} onHoldChange={handleHoldChange}>
        <div className="rounded-lg bg-[#FFFDF0] text-[#1F2937] p-4 text-base leading-relaxed">
          {explanation}
        </div>
      </HoldToReveal>
      <div className="mt-3">
        <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
          <div
            className="h-full bg-secondary transition-[width] duration-100"
            style={{ width: `${(remaining / HONEST_VIEW_BUDGET_MS) * 100}%` }}
          />
        </div>
        <div className="text-xs text-on-surface-variant mt-1 text-center">
          长按查看 · 剩余 {(remaining / 1000).toFixed(1)} 秒，用完就锁定
        </div>
      </div>
    </div>
  );
}

function BlufferCard({ gs }: { gs: BluffKingGameStateDTO }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      <HoldToReveal revealed={revealed} onHoldChange={setRevealed}>
        {gs.myFirstHalf && (
          <div className="rounded-lg bg-[#FFFDF0] text-[#1F2937] p-4 text-base leading-relaxed">
            {gs.myFirstHalf}
            <span className="text-[#9CA3AF]">……（后面靠你编）</span>
          </div>
        )}
        {gs.myHints && (
          <div className="space-y-2">
            {gs.myHints.map((hint, i) => (
              <div key={hint} className="rounded-lg bg-[#FFFDF0] text-[#1F2937] px-4 py-3 text-base">
                <span className="font-bold mr-2">{String.fromCharCode(65 + i)}.</span>
                {hint}
              </div>
            ))}
          </div>
        )}
      </HoldToReveal>
      <div className="text-xs text-on-surface-variant mt-2 text-center">
        {gs.myHints ? "长按查看 · 其中只有 1 个提示是真的" : "长按查看"}
      </div>
    </div>
  );
}

function ModePicker({ mode, onChange }: { mode: BluffMode; onChange: (m: BluffMode) => void }) {
  return (
    <div className="flex gap-2">
      {(Object.keys(MODE_LABEL) as BluffMode[]).map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 rounded-full text-sm transition-all ${
            mode === m
              ? "bg-primary text-on-primary shadow-neon-pink"
              : "bg-surface-container-high text-on-surface-variant"
          }`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

function Scoreboard({ players, scores, highlightIds = [], gains }: {
  players: PlayerDTO[];
  scores: Record<string, number>;
  highlightIds?: string[];
  gains?: Record<string, number>;
}) {
  const ranked = players
    .filter(p => scores[p.id] !== undefined)
    .sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));

  return (
    <div className="space-y-2">
      {ranked.map((player, i) => (
        <div
          key={player.id}
          className={`flex items-center gap-3 rounded-lg p-3 ${
            highlightIds.includes(player.id) ? "bg-warning/15 border border-warning/40" : "bg-surface-container/60"
          }`}
        >
          <span className="w-6 text-center font-bold text-on-surface-variant">{i + 1}</span>
          <Avatar avatar={player.avatar} size="sm" />
          <span className="flex-1 font-bold text-on-surface truncate">{player.nickname}</span>
          {gains?.[player.id] ? (
            <span className="text-xs text-tertiary font-bold">+{gains[player.id]}</span>
          ) : null}
          <span className="text-lg font-bold font-display text-on-surface w-10 text-right">
            {scores[player.id] || 0}
          </span>
        </div>
      ))}
    </div>
  );
}

export function BluffKingView({ gameState: gs }: { gameState: BluffKingGameStateDTO }) {
  const navigate = useNavigate();
  const { currentPlayer, isHost, players } = useGameState();
  const { performGameAction, submitVote, revealVotes, endGame, restartGame, voteWarning, clearVoteWarning } = useSocket();
  const [nextMode, setNextMode] = useState<BluffMode>(gs.mode);

  useEffect(() => setNextMode(gs.mode), [gs.mode, gs.round]);

  if (!currentPlayer) return null;

  const getPlayer = (id: string) => players.find(p => p.id === id);
  const getName = (id: string) => getPlayer(id)?.nickname || "已离开";
  const myRole = gs.myRole;
  const isGodView = isHost && !myRole;
  const isLastRound = gs.round >= gs.totalRounds;

  const votesFor = (speakerId: string) =>
    Object.entries(gs.revealedVotes || {})
      .filter(([, target]) => target === speakerId)
      .map(([voter]) => voter);

  const handleBackToLobby = () => {
    if (window.confirm("确定要回到游戏大厅吗？你可以通过房间号重新加入。")) {
      navigate("/");
    }
  };

  // ---------- Final leaderboard ----------
  if (gs.phase === "RESULT") {
    const topScore = Math.max(0, ...Object.values(gs.scores));
    const winners = Object.keys(gs.scores).filter(id => topScore > 0 && gs.scores[id] === topScore);
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-2xl mx-auto">
          <div className="glass rounded-lg p-6 mb-6 text-center shadow-glow">
            <h2 className="text-3xl font-bold font-display text-on-surface mb-2">游戏结束</h2>
            <p className="text-on-surface-variant">共进行 {gs.round} 轮</p>
            {winners.length > 0 && (
              <div className="text-2xl font-bold font-display mt-4 text-warning">
                👑 {winners.map(getName).join("、")}
              </div>
            )}
          </div>
          <div className="glass rounded-lg p-6">
            <h3 className="text-xl font-bold font-display text-on-surface mb-4">总排名</h3>
            <Scoreboard players={players} scores={gs.scores} highlightIds={winners} />
          </div>
          <div className="mt-6 flex justify-center gap-4">
            {isHost && (
              <DesertButton variant="primary" onClick={restartGame}>再来一局</DesertButton>
            )}
            <DesertButton variant="tertiary" onClick={() => navigate("/")}>返回大厅</DesertButton>
          </div>
        </div>
      </div>
    );
  }

  const isReveal = gs.phase === "REVEAL";
  const canVote = gs.phase === "PLAYING" && myRole === "GUESSER";

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={handleBackToLobby} className="text-sm text-on-surface-variant hover:text-on-surface">
            ← 游戏大厅
          </button>
          <span className="text-on-surface-variant text-lg font-display">
            第 {gs.round} / {gs.totalRounds} 轮
          </span>
          <span className="text-xs px-2 py-1 rounded-full bg-surface-container-high text-on-surface-variant">
            {MODE_LABEL[gs.mode]}
          </span>
        </div>

        {/* Word */}
        <div className="glass rounded-lg p-6 mb-6 text-center neon-border">
          <div className="text-xs text-on-surface-variant mb-2">{gs.category}</div>
          <div className="text-4xl font-bold font-display text-on-surface">{gs.word}</div>
          {gs.reading && <div className="text-on-surface-variant mt-2">{gs.reading}</div>}
        </div>

        {/* My role (playing phase) */}
        {!isReveal && myRole && (
          <div className="glass rounded-lg p-6 mb-6">
            <div className="text-sm text-on-surface-variant">你的身份</div>
            <div className={`text-2xl font-bold font-display mb-1 ${ROLE_INFO[myRole].color}`}>
              {ROLE_INFO[myRole].title}
            </div>
            <div className="text-sm text-on-surface-variant mb-4">{ROLE_INFO[myRole].desc}</div>
            {myRole === "HONEST" && (
              <HonestCard
                key={`${gs.round}-${gs.word}`}
                explanation={gs.myExplanation}
                locked={!!gs.honestLocked}
                onExpire={() => performGameAction("HONEST_VIEW_EXPIRED")}
              />
            )}
            {myRole === "BLUFFER" && <BlufferCard key={`${gs.round}-${gs.word}`} gs={gs} />}
          </div>
        )}

        {/* God view for a non-playing host */}
        {!isReveal && isGodView && (
          <div className="bg-warning/10 rounded-lg p-4 mb-6 border border-warning/30">
            <div className="text-warning text-sm font-bold mb-2">主持人视角</div>
            <div className="text-sm text-on-surface mb-2">{gs.explanation}</div>
            <div className="text-sm text-on-surface-variant">
              老实人：<span className="text-secondary font-bold">{gs.honestId ? getName(gs.honestId) : "-"}</span>
            </div>
            {gs.mode === "HINTS" && (
              <div className="text-sm text-on-surface-variant mt-1">
                真提示：<span className="text-tertiary">{gs.trueHint}</span>
              </div>
            )}
          </div>
        )}

        {/* Round reveal */}
        {isReveal && (
          <div className="glass rounded-lg p-6 mb-6 shadow-glow">
            <div className="text-sm text-on-surface-variant mb-2">真正的解释</div>
            <div className="rounded-lg bg-[#FFFDF0] text-[#1F2937] p-4 leading-relaxed mb-3">{gs.explanation}</div>
            {gs.mode === "HINTS" && (
              <div className="text-sm text-on-surface-variant">
                真提示：<span className="text-tertiary font-bold">{gs.trueHint}</span>
              </div>
            )}
            {gs.crownedIds && gs.crownedIds.length > 0 && (
              <div className="mt-3 text-center text-lg font-bold font-display text-warning">
                👑 本轮瞎掰王：{gs.crownedIds.map(getName).join("、")}
              </div>
            )}
          </div>
        )}

        {/* Vote warning */}
        {voteWarning && (
          <div className="bg-warning/15 rounded-lg p-4 mb-6 border border-warning/40">
            <div className="text-warning font-bold mb-2">还有 {voteWarning.notVoted.length} 位猜词人未投票</div>
            <div className="text-on-surface-variant text-sm mb-3">
              未投票：{voteWarning.notVoted.map(getName).join("、")}
            </div>
            <div className="flex gap-3">
              <DesertButton variant="primary" onClick={() => revealVotes(true)}>仍然揭晓</DesertButton>
              <DesertButton variant="tertiary" onClick={clearVoteWarning}>继续等待</DesertButton>
            </div>
          </div>
        )}

        {/* Host controls */}
        {isHost && (
          <div className="glass rounded-lg p-4 mb-6">
            <div className="text-sm text-on-surface-variant mb-3">房主控制</div>
            {!isReveal ? (
              <div className="flex gap-3 flex-wrap">
                <DesertButton variant="primary" onClick={() => revealVotes()}>揭晓投票</DesertButton>
                <DesertButton
                  variant="tertiary"
                  onClick={() => window.confirm("换一张题卡？身份保持不变。") && performGameAction("SKIP_CARD")}
                >
                  换一题
                </DesertButton>
                <DesertButton variant="tertiary" onClick={() => endGame()}>结束游戏</DesertButton>
              </div>
            ) : (
              <div className="space-y-3">
                {!isLastRound && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-on-surface-variant">下一轮模式</span>
                    <ModePicker mode={nextMode} onChange={setNextMode} />
                  </div>
                )}
                <div className="flex gap-3 flex-wrap">
                  <DesertButton variant="primary" onClick={() => performGameAction("NEXT_ROUND", { mode: nextMode })}>
                    {isLastRound ? "查看总排名" : "下一轮"}
                  </DesertButton>
                  {!isLastRound && (
                    <DesertButton variant="tertiary" onClick={() => endGame()}>结束游戏</DesertButton>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Speakers */}
        <div className="glass rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold font-display text-on-surface">发言顺序</h3>
            {!isReveal && (
              <span className="text-sm text-on-surface-variant">
                已投票 {gs.votedPlayerIds.length} / {gs.guesserIds.length}
              </span>
            )}
          </div>
          {canVote && (
            <p className="text-sm text-tertiary mb-3">听完所有人发言后，点选你认为的老实人（可更改）</p>
          )}
          <div className="space-y-3">
            {gs.speakerOrder.map((speakerId, i) => {
              const player = getPlayer(speakerId);
              const isMine = gs.myVoteTarget === speakerId;
              const isHonest = gs.honestId === speakerId;
              const voters = votesFor(speakerId);
              const isCrowned = gs.crownedIds?.includes(speakerId);
              return (
                <div
                  key={speakerId}
                  onClick={() => canVote && submitVote(speakerId)}
                  className={`rounded-lg p-4 transition-all border ${
                    isReveal && isHonest ? "bg-secondary/15 border-secondary/60"
                    : isMine ? "bg-primary/15 border-primary/60 shadow-neon-pink"
                    : canVote ? "bg-surface-container/60 border-transparent cursor-pointer active:bg-surface-container-high/80"
                    : "bg-surface-container/60 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-bold font-display text-on-surface-variant">{i + 1}</span>
                    <Avatar avatar={player?.avatar} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-on-surface truncate">
                        {getName(speakerId)}
                        {speakerId === currentPlayer.id && <span className="text-xs text-on-surface-variant ml-2">(我)</span>}
                        {isCrowned && <span className="ml-2">👑</span>}
                      </div>
                      {(isReveal || isGodView) && (
                        <div className={`text-xs ${isHonest ? "text-secondary" : "text-primary"}`}>
                          {isHonest ? "老实人" : "瞎掰王"}
                          {isGodView && !isHonest && gs.mode === "HINTS" && gs.allHints?.[speakerId] && (
                            <span className="text-outline ml-2">{gs.allHints[speakerId].join(" / ")}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {isMine && !isReveal && <span className="text-xs text-primary font-bold">你的投票</span>}
                    {isReveal && <span className="text-sm text-warning font-bold">{voters.length} 票</span>}
                  </div>
                  {isReveal && voters.length > 0 && (
                    <div className="mt-2 text-xs text-on-surface-variant">
                      投票者：{voters.map(getName).join("、")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {gs.guesserIds.length > 0 && (
            <div className="mt-4 text-sm text-on-surface-variant">
              猜词人：
              {gs.guesserIds.map(id => (
                <span key={id} className="mr-2">
                  {getName(id)}
                  {!isReveal && gs.votedPlayerIds.includes(id) && <span className="text-tertiary"> ✓</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Scores */}
        <div className="glass rounded-lg p-6">
          <h3 className="text-xl font-bold font-display text-on-surface mb-4">积分</h3>
          <Scoreboard
            players={players}
            scores={gs.scores}
            gains={isReveal ? gs.roundGains : undefined}
          />
          {isReveal && (
            <p className="text-xs text-outline mt-3">
              猜中老实人：猜词人和老实人各 +1；瞎掰王每骗到 1 票 +1
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
