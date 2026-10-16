import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameState } from "../hooks/useGameState";
import { useSocket } from "../hooks/useSocket";
import { DesertButton } from "../components/DesertButton";
import { PlayerCard } from "../components/PlayerCard";
import { GameTypeEnum } from "@shared/types/enums";
import { RoomConfig } from "@shared/types/room";
import { BluffMode } from "@shared/types/game-state";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "";

interface WordPair {
  A: string;
  B: string;
  category: string;
}

interface WordCategory {
  name: string;
  pairs: WordPair[];
}

interface TaskItem {
  description: string;
  category: string;
}

interface TaskCategory {
  name: string;
  tasks: TaskItem[];
}

export function LobbyView() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { room, currentPlayer, isHost, players } = useGameState();
  const { startGame, setReady, kickPlayer, updatePlayer } = useSocket();

  const isTaskWolf = room?.gameType === GameTypeEnum.TASKWOLF;

  // Game config state (host only)
  const [hostIsPlaying, setHostIsPlaying] = useState(true);
  const [numUndercovers, setNumUndercovers] = useState(1);
  const [numWolves, setNumWolves] = useState(1);
  const [designatedWolfIds, setDesignatedWolfIds] = useState<string[]>([]);
  const [useDesignatedWolves, setUseDesignatedWolves] = useState(false);
  const [spyWordMode, setSpyWordMode] = useState<'same' | 'blank'>('same');
  const [bluffMode, setBluffMode] = useState<BluffMode>('HALF');
  const [bluffRounds, setBluffRounds] = useState<number | null>(null); // null = one per player

  // Word categories and pair preview
  const [categories, setCategories] = useState<WordCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(""); // "" = all
  const [currentWordPair, setCurrentWordPair] = useState<WordPair | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editWordA, setEditWordA] = useState("");
  const [editWordB, setEditWordB] = useState("");

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/word-categories`);
      const cats: WordCategory[] = await res.json();
      setCategories(cats);
    } catch (e) {
      console.error("Failed to fetch word categories:", e);
    }
  }, []);

  useEffect(() => {
    if (isHost && categories.length === 0) {
      fetchCategories();
    }
  }, [isHost, categories.length, fetchCategories]);

  // Get pairs for current category selection
  const availablePairs = selectedCategory
    ? categories.find(c => c.name === selectedCategory)?.pairs || []
    : categories.flatMap(c => c.pairs);

  // Pick a random pair from available when non-playing host needs preview
  const pickRandomPair = useCallback(() => {
    if (availablePairs.length === 0) return;
    const randomPair = availablePairs[Math.floor(Math.random() * availablePairs.length)];
    setCurrentWordPair(randomPair);
    setEditWordA(randomPair.A);
    setEditWordB(randomPair.B);
    setIsEditing(false);
  }, [availablePairs]);

  // Auto-pick when switching to non-playing and no pair selected yet
  useEffect(() => {
    if (!hostIsPlaying && !currentWordPair && availablePairs.length > 0) {
      pickRandomPair();
    }
  }, [hostIsPlaying, currentWordPair, availablePairs.length, pickRandomPair]);

  const handleShuffle = () => {
    pickRandomPair();
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    setCurrentWordPair(null); // reset so a new pair is picked
  };

  // TaskWolf: task categories and preview
  const [taskCategories, setTaskCategories] = useState<TaskCategory[]>([]);
  const [selectedTaskCategory, setSelectedTaskCategory] = useState<string>("");
  const [currentTask, setCurrentTask] = useState<TaskItem | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editTaskDesc, setEditTaskDesc] = useState("");

  const fetchTaskCategories = useCallback(async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/task-categories`);
      const cats: TaskCategory[] = await res.json();
      setTaskCategories(cats);
    } catch (e) {
      console.error("Failed to fetch task categories:", e);
    }
  }, []);

  useEffect(() => {
    if (isHost && isTaskWolf && taskCategories.length === 0) {
      fetchTaskCategories();
    }
  }, [isHost, isTaskWolf, taskCategories.length, fetchTaskCategories]);

  const availableTaskItems = selectedTaskCategory
    ? taskCategories.find(c => c.name === selectedTaskCategory)?.tasks || []
    : taskCategories.flatMap(c => c.tasks);

  const pickRandomTask = useCallback(() => {
    if (availableTaskItems.length === 0) return;
    const t = availableTaskItems[Math.floor(Math.random() * availableTaskItems.length)];
    setCurrentTask(t);
    setEditTaskDesc(t.description);
    setIsEditingTask(false);
  }, [availableTaskItems]);

  useEffect(() => {
    if (isTaskWolf && !currentTask && availableTaskItems.length > 0) {
      pickRandomTask();
    }
  }, [isTaskWolf, currentTask, availableTaskItems.length, pickRandomTask]);

  const handleTaskCategoryChange = (cat: string) => {
    setSelectedTaskCategory(cat);
    setCurrentTask(null);
  };

  const handleTaskEditSave = () => {
    if (editTaskDesc.trim()) {
      setCurrentTask({ description: editTaskDesc.trim(), category: "自定义" });
      setIsEditingTask(false);
    }
  };

  const handleEditSave = () => {
    if (editWordA.trim() && editWordB.trim()) {
      setCurrentWordPair({ A: editWordA.trim(), B: editWordB.trim(), category: "自定义" });
      setIsEditing(false);
    }
  };

  const sortedPlayers = [
    ...players.filter(p => p.isHost),
    ...players.filter(p => !p.isHost),
  ];

  const nonHostPlayers = players.filter(
    p => !p.isHost && p.isPlaying && p.isAlive
  );
  const allPlayersReady = nonHostPlayers.every(p => p.isReady);

  // Calculate max spies/wolves: floor((playerCount - 1) / 3), min 1, max 3
  const effectiveHostPlaying = isTaskWolf ? false : hostIsPlaying;
  const totalPlayingCount = effectiveHostPlaying
    ? players.length
    : nonHostPlayers.length;
  const maxBadGuys = Math.min(3, Math.max(1, Math.floor((totalPlayingCount - 1) / 3)));

  const effectiveNumUndercovers = Math.min(numUndercovers, maxBadGuys);
  const effectiveNumWolves = Math.min(numWolves, maxBadGuys);
  const effectiveBluffRounds = bluffRounds ?? Math.max(1, totalPlayingCount);

  const handleStartGame = () => {
    if (!room || !room.gameType) return;

    if (room.gameType === GameTypeEnum.COLOUR_HUNT) {
      startGame(room.gameType, { hostIsPlaying: true });
      return;
    }

    if (room.gameType === GameTypeEnum.BLUFF_KING) {
      startGame(room.gameType, {
        hostIsPlaying,
        bluffMode,
        bluffRounds: effectiveBluffRounds,
      });
      return;
    }

    if (isTaskWolf) {
      const config: RoomConfig = {
        hostIsPlaying: false,
        numWolves: effectiveNumWolves,
        taskCategory: selectedTaskCategory || undefined,
        customTasks: currentTask ? [currentTask.description] : undefined,
        designatedWolfIds: useDesignatedWolves && designatedWolfIds.length > 0
          ? designatedWolfIds : undefined,
      };
      startGame(room.gameType, config);
    } else {
      const config: RoomConfig = {
        hostIsPlaying: effectiveHostPlaying,
        numUndercovers: effectiveNumUndercovers,
        spyWordMode,
        wordCategory: selectedCategory || undefined,
      };
      if (!effectiveHostPlaying && currentWordPair) {
        config.customWordPairs = [currentWordPair];
      }
      startGame(room.gameType, config);
    }
  };

  const handleReadyToggle = () => {
    if (!room || !roomId || !currentPlayer || currentPlayer.isHost) return;
    setReady(roomId, !currentPlayer.isReady);
  };

  const handleShare = () => {
    if (roomId) {
      navigate(`/share/${roomId}`);
    }
  };

  const handleKickPlayer = (targetPlayerId: string) => {
    if (!roomId || !isHost) return;
    if (window.confirm("确定要移出该玩家吗？")) {
      kickPlayer(roomId, targetPlayerId);
    }
  };

  if (!room) return null;

  const isUndercover = room.gameType === GameTypeEnum.UNDERCOVER;
  const isColourHunt = room.gameType === GameTypeEnum.COLOUR_HUNT;
  const isBluffKing = room.gameType === GameTypeEnum.BLUFF_KING;
  const minPlayers = isColourHunt ? 2 : isBluffKing ? 4 : 3;
  const canStart = room.gameType && totalPlayingCount >= minPlayers && allPlayersReady;

  return (
    <div className={`min-h-screen p-4 ${!isHost ? "pb-28" : ""}`}>
      <div className="max-w-2xl mx-auto">
        {/* Room Info */}
        <div className="glass rounded-lg p-6 mb-6">
          <div className="text-center mb-4">
            <h2 className="text-3xl font-bold font-display text-on-surface mb-2">
              房间: <span className="bg-primary-gradient bg-clip-text text-transparent">{room.id}</span>
            </h2>
            <p className="text-on-surface-variant">
              {room.gameType
                ? `游戏: ${
                    room.gameType === GameTypeEnum.UNDERCOVER
                      ? "谁是卧底"
                      : room.gameType === GameTypeEnum.TASKWOLF
                      ? "任务狼人杀"
                      : room.gameType === GameTypeEnum.COLOUR_HUNT
                      ? "野餐 Colour Hunt"
                      : room.gameType === GameTypeEnum.BLUFF_KING
                      ? "谁是瞎掰王"
                      : room.gameType
                  }`
                : "等待游戏开始"}
            </p>
          </div>

          {isHost && (
            <>
              <div className="flex gap-4 justify-center">
                <DesertButton
                  variant="primary"
                  onClick={handleStartGame}
                  disabled={!canStart}
                >
                  开始游戏
                </DesertButton>
                <DesertButton variant="tertiary" onClick={handleShare}>
                  分享房间
                </DesertButton>
              </div>
              {!canStart && (
                <div className="text-center mt-2 text-sm text-on-surface-variant">
                  {!room.gameType
                    ? "请选择游戏类型"
                    : totalPlayingCount < minPlayers
                    ? `至少需要 ${minPlayers} 名玩家（当前 ${totalPlayingCount} 人）`
                    : !allPlayersReady
                    ? "等待所有玩家准备..."
                    : ""}
                </div>
              )}
            </>
          )}
        </div>

        {/* Game Config (host only, Undercover game) */}
        {isHost && isUndercover && (
          <div className="glass rounded-lg p-6 mb-6">
            <h3 className="text-xl font-bold font-display text-on-surface mb-4">游戏设置</h3>

            {/* Host plays toggle */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-on-surface-variant">房主参与游戏</span>
              <button
                onClick={() => setHostIsPlaying(!hostIsPlaying)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  hostIsPlaying ? "bg-primary shadow-neon-pink" : "bg-surface-container-high"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    hostIsPlaying ? "translate-x-6" : ""
                  }`}
                />
              </button>
            </div>

            {/* Number of spies */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-on-surface-variant">卧底人数</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNumUndercovers(Math.max(1, effectiveNumUndercovers - 1))}
                  disabled={effectiveNumUndercovers <= 1}
                  className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold disabled:opacity-40"
                >
                  -
                </button>
                <span className="text-on-surface font-bold w-6 text-center">
                  {effectiveNumUndercovers}
                </span>
                <button
                  onClick={() => setNumUndercovers(Math.min(maxBadGuys, effectiveNumUndercovers + 1))}
                  disabled={effectiveNumUndercovers >= maxBadGuys}
                  className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-xs text-outline mb-4">
              当前 {totalPlayingCount} 人游戏，最多 {maxBadGuys} 名卧底
            </p>

            {/* Spy word mode */}
            <div className="mb-4">
              <span className="text-on-surface-variant block mb-2">卧底词语</span>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="spyWordMode"
                    checked={spyWordMode === 'same'}
                    onChange={() => setSpyWordMode('same')}
                    className="accent-primary"
                  />
                  <span className="text-on-surface-variant text-sm">相同词语</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="spyWordMode"
                    checked={spyWordMode === 'blank'}
                    onChange={() => setSpyWordMode('blank')}
                    className="accent-primary"
                  />
                  <span className="text-on-surface-variant text-sm">空白卡 (无词语)</span>
                </label>
              </div>
            </div>

            {/* Word category selector */}
            {categories.length > 0 && (
              <div className="mb-4">
                <span className="text-on-surface-variant block mb-2">词语分类</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleCategoryChange("")}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      selectedCategory === ""
                        ? "bg-primary text-on-primary shadow-neon-pink"
                        : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                    }`}
                  >
                    全部
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.name}
                      onClick={() => handleCategoryChange(cat.name)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                        selectedCategory === cat.name
                          ? "bg-primary text-on-primary shadow-neon-pink"
                          : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                      }`}
                    >
                      {cat.name} ({cat.pairs.length})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Word pair preview (non-playing host only) */}
            {!hostIsPlaying && currentWordPair && (
              <div className="border-t border-outline-variant pt-4">
                <span className="text-on-surface-variant block mb-3">词语预览</span>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-primary text-sm w-16">平民词:</span>
                      <input
                        type="text"
                        value={editWordA}
                        onChange={e => setEditWordA(e.target.value)}
                        className="flex-1 bg-surface-container text-on-surface rounded px-3 py-2 text-sm border border-outline-variant focus:border-primary outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-error text-sm w-16">卧底词:</span>
                      <input
                        type="text"
                        value={editWordB}
                        onChange={e => setEditWordB(e.target.value)}
                        className="flex-1 bg-surface-container text-on-surface rounded px-3 py-2 text-sm border border-outline-variant focus:border-primary outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleEditSave}
                        disabled={!editWordA.trim() || !editWordB.trim()}
                        className="px-3 py-1.5 bg-primary/80 hover:bg-primary text-on-primary rounded text-sm font-bold disabled:opacity-40 shadow-neon-pink"
                      >
                        确定
                      </button>
                      <button
                        onClick={() => {
                          setEditWordA(currentWordPair.A);
                          setEditWordB(currentWordPair.B);
                          setIsEditing(false);
                        }}
                        className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-sm"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="bg-surface-container rounded-lg p-4 mb-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-primary">平民词</span>
                        <span className="text-sm text-error">卧底词</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xl font-bold text-on-surface">{currentWordPair.A}</span>
                        <span className="text-outline mx-2">vs</span>
                        <span className="text-xl font-bold text-on-surface">{currentWordPair.B}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleShuffle}
                        className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-sm"
                      >
                        换一组
                      </button>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-sm"
                      >
                        自定义
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Game Config (host only, Bluff King game) */}
        {isHost && isBluffKing && (
          <div className="glass rounded-lg p-6 mb-6">
            <h3 className="text-xl font-bold font-display text-on-surface mb-4">游戏设置</h3>

            {/* Host plays toggle */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-on-surface-variant">房主参与游戏</span>
              <button
                onClick={() => setHostIsPlaying(!hostIsPlaying)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  hostIsPlaying ? "bg-primary shadow-neon-pink" : "bg-surface-container-high"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    hostIsPlaying ? "translate-x-6" : ""
                  }`}
                />
              </button>
            </div>
            {!hostIsPlaying && (
              <p className="text-xs text-outline -mt-2 mb-4">房主作为主持人，可以看到完整题卡和所有人的身份</p>
            )}

            {/* Bluffer info mode */}
            <div className="mb-4">
              <span className="text-on-surface-variant block mb-2">瞎掰王能看到</span>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { mode: 'HALF', title: "前半段解释", desc: "看得到开头，后半段靠编" },
                  { mode: 'HINTS', title: "三选一提示", desc: "3 个提示，只有 1 个是真的" },
                ] as const).map(opt => (
                  <button
                    key={opt.mode}
                    onClick={() => setBluffMode(opt.mode)}
                    className={`rounded-lg p-3 text-left transition-all border ${
                      bluffMode === opt.mode
                        ? "border-primary bg-primary/15 shadow-neon-pink"
                        : "border-outline-variant bg-surface-container-high"
                    }`}
                  >
                    <div className="text-on-surface font-bold text-sm">{opt.title}</div>
                    <div className="text-on-surface-variant text-xs mt-1">{opt.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-outline mt-2">每轮结束后可以切换</p>
            </div>

            {/* Rounds */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-on-surface-variant">游戏轮数</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setBluffRounds(Math.max(1, effectiveBluffRounds - 1))}
                  disabled={effectiveBluffRounds <= 1}
                  className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold disabled:opacity-40"
                >
                  -
                </button>
                <span className="text-on-surface font-bold w-6 text-center">
                  {effectiveBluffRounds}
                </span>
                <button
                  onClick={() => setBluffRounds(Math.min(30, effectiveBluffRounds + 1))}
                  disabled={effectiveBluffRounds >= 30}
                  className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-xs text-outline">
              当前 {totalPlayingCount} 人：{Math.max(0, Math.min(totalPlayingCount - 1, 5))} 人发言（1 老实人 + 瞎掰王），
              其余猜词。轮数 = 人数时每人都会当一次老实人
            </p>
          </div>
        )}

        {/* Game Config (host only, TaskWolf game) */}
        {isHost && isTaskWolf && (
          <div className="glass rounded-lg p-6 mb-6">
            <h3 className="text-xl font-bold font-display text-on-surface mb-4">游戏设置</h3>

            {/* Number of wolves */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-on-surface-variant">狼人人数</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNumWolves(Math.max(1, effectiveNumWolves - 1))}
                  disabled={effectiveNumWolves <= 1}
                  className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold disabled:opacity-40"
                >
                  -
                </button>
                <span className="text-on-surface font-bold w-6 text-center">
                  {effectiveNumWolves}
                </span>
                <button
                  onClick={() => setNumWolves(Math.min(maxBadGuys, effectiveNumWolves + 1))}
                  disabled={effectiveNumWolves >= maxBadGuys}
                  className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-xs text-outline mb-4">
              当前 {totalPlayingCount} 人游戏，最多 {maxBadGuys} 名狼人
            </p>

            {/* Designate wolves toggle */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-on-surface-variant">指定狼人</span>
              <button
                onClick={() => {
                  setUseDesignatedWolves(!useDesignatedWolves);
                  if (useDesignatedWolves) setDesignatedWolfIds([]);
                }}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  useDesignatedWolves ? "bg-primary shadow-neon-pink" : "bg-surface-container-high"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    useDesignatedWolves ? "translate-x-6" : ""
                  }`}
                />
              </button>
            </div>

            {useDesignatedWolves && (
              <div className="mb-4">
                <p className="text-xs text-outline mb-2">
                  点击玩家选为狼人（已选 {designatedWolfIds.length} 人）
                </p>
                <div className="flex flex-wrap gap-2">
                  {nonHostPlayers.map(player => {
                    const isSelected = designatedWolfIds.includes(player.id);
                    return (
                      <button
                        key={player.id}
                        onClick={() => {
                          if (isSelected) {
                            setDesignatedWolfIds(designatedWolfIds.filter(id => id !== player.id));
                          } else {
                            setDesignatedWolfIds([...designatedWolfIds, player.id]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                          isSelected
                            ? "bg-error text-on-error shadow-[0_0_12px_rgba(255,23,68,0.4)]"
                            : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                        }`}
                      >
                        {player.nickname} {isSelected ? "🐺" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Task category selector */}
            {taskCategories.length > 0 && (
              <div className="mb-4">
                <span className="text-on-surface-variant block mb-2">任务分类</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleTaskCategoryChange("")}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      selectedTaskCategory === ""
                        ? "bg-primary text-on-primary shadow-neon-pink"
                        : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                    }`}
                  >
                    全部
                  </button>
                  {taskCategories.map(cat => (
                    <button
                      key={cat.name}
                      onClick={() => handleTaskCategoryChange(cat.name)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                        selectedTaskCategory === cat.name
                          ? "bg-primary text-on-primary shadow-neon-pink"
                          : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                      }`}
                    >
                      {cat.name} ({cat.tasks.length})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Task preview */}
            {currentTask && (
              <div className="border-t border-outline-variant pt-4">
                <span className="text-on-surface-variant block mb-3">任务预览</span>
                {isEditingTask ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editTaskDesc}
                      onChange={e => setEditTaskDesc(e.target.value)}
                      className="w-full bg-surface-container text-on-surface rounded px-3 py-2 text-sm border border-outline-variant focus:border-primary outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleTaskEditSave}
                        disabled={!editTaskDesc.trim()}
                        className="px-3 py-1.5 bg-primary/80 hover:bg-primary text-on-primary rounded text-sm font-bold disabled:opacity-40 shadow-neon-pink"
                      >
                        确定
                      </button>
                      <button
                        onClick={() => {
                          setEditTaskDesc(currentTask.description);
                          setIsEditingTask(false);
                        }}
                        className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-sm"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="bg-surface-container rounded-lg p-4 mb-3">
                      <div className="text-sm text-error mb-1">狼人任务</div>
                      <div className="text-lg font-bold text-on-surface">{currentTask.description}</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={pickRandomTask}
                        className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-sm"
                      >
                        换一个
                      </button>
                      <button
                        onClick={() => setIsEditingTask(true)}
                        className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-sm"
                      >
                        自定义
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Players List */}
        <div className="glass rounded-lg p-6">
          <h3 className="text-2xl font-bold font-display text-on-surface mb-4">
            玩家 ({players.length})
          </h3>
          <div className="space-y-3">
            {sortedPlayers.map(player => (
              <div key={player.id} className="flex items-center gap-2">
                <div className="flex-1">
                  <PlayerCard
                    player={player}
                    isCurrentPlayer={player.id === currentPlayer?.id}
                    onUpdate={
                      player.id === currentPlayer?.id && roomId
                        ? (updates) => updatePlayer(roomId, updates)
                        : undefined
                    }
                  />
                </div>
                {isHost && !player.isHost && (
                  <button
                    onClick={() => handleKickPlayer(player.id)}
                    className="px-3 py-2 bg-error hover:bg-error/90 text-on-error rounded-lg text-sm font-semibold transition-colors shadow-[0_0_8px_rgba(255,23,68,0.3)]"
                    title="移出玩家"
                  >
                    移出
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Ready control for players - sticky bottom */}
        {!isHost && (
          <div className="fixed bottom-0 left-0 right-0 bg-surface/95 border-t border-outline-variant p-4 backdrop-blur-xl">
            <div className="max-w-2xl mx-auto text-center">
              <DesertButton
                variant="primary"
                onClick={handleReadyToggle}
                className="w-full max-w-md"
              >
                {currentPlayer?.isReady ? "取消准备" : "准备"}
              </DesertButton>
              <div className="mt-1 text-sm text-on-surface-variant">
                等待房主开始游戏...
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
