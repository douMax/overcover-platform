import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DesertButton } from "../components/DesertButton";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "";

interface RoomInfo {
  id: string;
  status: string;
  gameType: string | null;
  playerCount: number;
  connectedCount: number;
  players: {
    nickname: string;
    isHost: boolean;
    isConnected: boolean;
    isAlive: boolean;
  }[];
  gamePhase: string | null;
  createdBy: string;
}

const STATUS_LABELS: Record<string, string> = {
  WAITING: "等待中",
  PLAYING: "游戏中",
  RESULT: "已结束",
};

const GAME_LABELS: Record<string, string> = {
  UNDERCOVER: "谁是卧底",
  TASKWOLF: "任务狼人杀",
  COLOUR_HUNT: "野餐 Colour Hunt",
  BLUFF_KING: "谁是瞎掰王",
};

const PHASE_LABELS: Record<string, string> = {
  PLAYING: "进行中",
  REVEAL: "投票揭晓",
  RESULT: "已结束",
};

export function AdminView() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchRooms = async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/rooms`);
      const data: RoomInfo[] = await res.json();
      setRooms(data);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch rooms:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-on-surface">房间管理</h1>
            <p className="text-sm text-on-surface-variant">
              {rooms.length} 个活跃房间
              {lastRefresh && (
                <span> · 上次刷新 {lastRefresh.toLocaleTimeString()}</span>
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <DesertButton variant="tertiary" onClick={fetchRooms}>
              刷新
            </DesertButton>
            <button
              onClick={() => navigate("/")}
              className="text-sm text-on-surface-variant hover:text-on-surface"
            >
              ← 返回
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-on-surface-variant py-12">加载中...</div>
        ) : rooms.length === 0 ? (
          <div className="text-center text-outline py-12">
            暂无活跃房间
          </div>
        ) : (
          <div className="space-y-4">
            {rooms.map(room => (
              <div
                key={room.id}
                className="glass rounded-lg p-5"
              >
                {/* Room header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-on-surface font-mono">
                      {room.id}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      room.status === "PLAYING"
                        ? "bg-tertiary/15 text-tertiary"
                        : room.status === "WAITING"
                        ? "bg-warning/15 text-warning"
                        : "bg-surface-container text-on-surface-variant"
                    }`}>
                      {STATUS_LABELS[room.status] || room.status}
                    </span>
                    {room.gameType && (
                      <span className="text-xs text-on-surface-variant">
                        {GAME_LABELS[room.gameType] || room.gameType}
                      </span>
                    )}
                    {room.gamePhase && (
                      <span className="text-xs text-outline">
                        · {PHASE_LABELS[room.gamePhase] || room.gamePhase}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/join/${room.id}`)}
                    className="text-xs text-primary hover:text-primary-container"
                  >
                    加入
                  </button>
                </div>

                {/* Players */}
                <div className="flex flex-wrap gap-2">
                  {room.players.map((player, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 bg-surface-container/40 rounded-full px-3 py-1"
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          player.isConnected ? "bg-tertiary shadow-neon-green" : "bg-outline"
                        }`}
                      />
                      <span className={`text-sm ${
                        player.isConnected ? "text-on-surface" : "text-outline"
                      }`}>
                        {player.nickname}
                      </span>
                      {player.isHost && (
                        <span className="text-xs text-secondary">主</span>
                      )}
                      {!player.isAlive && (
                        <span className="text-xs text-outline">淘汰</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="mt-2 text-xs text-outline">
                  {room.connectedCount}/{room.playerCount} 在线
                  · 房主: {room.createdBy}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
