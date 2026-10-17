import { useState } from "react";
import { FeedbackReason } from "@shared/events";
import { useSocket } from "../hooks/useSocket";

const REASONS: Array<{ id: FeedbackReason; label: string }> = [
  { id: "funny", label: "好玩" },
  { id: "too_easy", label: "太简单" },
  { id: "too_hard", label: "太难" },
  { id: "never_heard", label: "没听过" },
  { id: "boring", label: "没意思" },
];

/**
 * One-tap 👍/👎 for the card just revealed. Reasons are optional and can be
 * toggled after rating; each change re-sends (the server keeps the latest).
 */
export function FeedbackBar() {
  const { submitFeedback } = useSocket();
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [failed, setFailed] = useState(false);

  const send = async (r: 1 | -1, rs: FeedbackReason[]) => {
    setRating(r);
    setReasons(rs);
    setFailed(!(await submitFeedback(r, rs)));
  };

  const toggleReason = (id: FeedbackReason) => {
    if (rating === null) return;
    send(rating, reasons.includes(id) ? reasons.filter(x => x !== id) : [...reasons, id]);
  };

  return (
    <div className="rounded-lg bg-surface-container/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-on-surface-variant">
          {rating === null ? "这道题怎么样？" : failed ? "没发送成功，再点一次试试" : "谢谢反馈！"}
        </span>
        <div className="flex gap-2">
          {([1, -1] as const).map(r => (
            <button
              key={r}
              onClick={() => send(r, reasons)}
              aria-label={r === 1 ? "好题" : "不好"}
              className={`w-11 h-11 rounded-full text-xl transition-all ${
                rating === r
                  ? "bg-primary/25 border border-primary shadow-neon-pink"
                  : "bg-surface-container-high border border-transparent"
              }`}
            >
              {r === 1 ? "👍" : "👎"}
            </button>
          ))}
        </div>
      </div>
      {rating !== null && (
        <div className="flex flex-wrap gap-2 mt-3">
          {REASONS.map(reason => (
            <button
              key={reason.id}
              onClick={() => toggleReason(reason.id)}
              className={`px-3 py-1 rounded-full text-xs transition-all ${
                reasons.includes(reason.id)
                  ? "bg-secondary text-on-secondary"
                  : "bg-surface-container-high text-on-surface-variant"
              }`}
            >
              {reason.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
