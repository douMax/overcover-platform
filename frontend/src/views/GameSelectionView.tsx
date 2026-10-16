import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { DesertButton } from "../components/DesertButton";
import { GameTypeEnum } from "@shared/types/enums";

interface GameCard {
  id: GameTypeEnum;
  title: string;
  subtitle: string;
  icon: string;
  enabled: boolean;
  accentColor: string;
  glowColor: string;
}

const GAMES: GameCard[] = [
  {
    id: GameTypeEnum.UNDERCOVER,
    title: "谁是卧底",
    subtitle: "找出隐藏在人群中的卧底",
    icon: "mdi:incognito",
    enabled: true,
    accentColor: "from-primary to-primary-container",
    glowColor: "rgba(224, 64, 251, 0.3)",
  },
  {
    id: GameTypeEnum.BLUFF_KING,
    title: "谁是瞎掰王",
    subtitle: "一本正经地胡说八道",
    icon: "mdi:drama-masks",
    enabled: true,
    accentColor: "from-secondary to-primary",
    glowColor: "rgba(0, 229, 255, 0.3)",
  },
  {
    id: GameTypeEnum.TASKWOLF,
    title: "任务狼人杀",
    subtitle: "完成任务，找出狼人",
    icon: "mdi:wolf",
    enabled: false,
    accentColor: "from-secondary to-secondary-container",
    glowColor: "rgba(0, 229, 255, 0.3)",
  },
  {
    id: "COLOUR_HUNT" as GameTypeEnum,
    title: "Colour Hunt",
    subtitle: "野餐配色挑战",
    icon: "mdi:palette",
    enabled: false,
    accentColor: "from-tertiary to-[#00c853]",
    glowColor: "rgba(118, 255, 3, 0.3)",
  },
];

export function GameSelectionView() {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState("");

  const handleSelectGame = (game: GameCard) => {
    if (!game.enabled) return;
    navigate(`/create/${game.id}`);
  };

  const handleJoin = () => {
    if (!joinRoomId.trim()) return;
    navigate(`/join/${joinRoomId.trim().toUpperCase()}`);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="text-center mb-10">
        <h1 className="text-6xl font-bold font-display text-on-surface mb-4">
          <span className="bg-primary-gradient bg-clip-text text-transparent">Overcover</span>
        </h1>
        <p className="text-xl text-on-surface-variant">选择游戏或加入房间</p>
      </div>

      <div className="w-full max-w-2xl">
        {/* Game grid */}
        <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-3">
          {GAMES.map(game => (
            <button
              key={game.id}
              onClick={() => handleSelectGame(game)}
              disabled={!game.enabled}
              className={`
                group relative glass rounded-xl p-5 text-left
                transition-all duration-200
                ${game.enabled
                  ? "cursor-pointer hover:scale-[1.03] active:scale-[0.98]"
                  : "cursor-not-allowed opacity-60"
                }
              `}
              style={game.enabled ? {
                boxShadow: `0 0 20px ${game.glowColor}, inset 0 0 20px ${game.glowColor.replace("0.3", "0.05")}`,
              } : undefined}
            >
              {/* Coming soon badge */}
              {!game.enabled && (
                <span className="absolute top-2.5 right-2.5 text-[10px] font-bold uppercase tracking-wider bg-outline/40 text-on-surface-variant px-2 py-0.5 rounded-full">
                  Soon
                </span>
              )}

              {/* Icon */}
              <div className={`
                w-12 h-12 rounded-lg flex items-center justify-center mb-4
                bg-gradient-to-br ${game.accentColor}
              `}>
                <Icon icon={game.icon} width={28} height={28} className="text-white" />
              </div>

              {/* Text */}
              <div className="text-on-surface font-bold font-display text-lg leading-tight mb-1">
                {game.title}
              </div>
              <div className="text-on-surface-variant text-xs leading-snug">
                {game.subtitle}
              </div>
            </button>
          ))}
        </div>

        {/* Join room */}
        <div className="glass rounded-xl p-6">
          <div className="text-on-surface font-semibold mb-3">加入房间</div>
          <div className="flex gap-3">
            <input
              type="text"
              value={joinRoomId}
              onChange={e => setJoinRoomId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleJoin()}
              placeholder="输入房间号"
              className="flex-1 px-4 py-3 rounded-lg bg-surface-container border border-outline-variant text-on-surface placeholder-outline focus:outline-none focus:border-primary"
              maxLength={6}
            />
            <DesertButton
              variant="tertiary"
              onClick={handleJoin}
              disabled={!joinRoomId.trim()}
            >
              加入
            </DesertButton>
          </div>
        </div>
      </div>
    </div>
  );
}
