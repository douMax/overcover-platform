import { readFileSync } from "fs";
import { join } from "path";
import { BluffCard } from "../../../shared/types/game-state";

const FIELD_KEYS: Record<string, keyof BluffCard> = {
  "完整解释": "explanation",
  "前半段": "firstHalf",
  "真提示": "trueHint",
};

/**
 * Loads Bluff King cards from docs/bluff-list.md
 *
 * Expected format:
 *   ## 🏮 Category
 *   ### 01 Word（reading）     ← the number is the stable id (bk-001); never reuse it
 *   - **完整解释**：...
 *   - **前半段**：...
 *   - **真提示**：...
 *   - **干扰提示**：a ／ b ／ c ／ d
 */
export function loadBluffCards(): BluffCard[] {
  const listPath = join(__dirname, "../../../docs/bluff-list.md");
  const content = readFileSync(listPath, "utf-8");

  const cards: BluffCard[] = [];
  let category = "";
  let current: Partial<BluffCard> | null = null;

  const flush = () => {
    if (current && isCompleteCard(current)) {
      cards.push(current);
    } else if (current) {
      console.warn(`Skipping incomplete bluff card: ${current.word}`);
    }
    current = null;
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    const cardMatch = line.match(/^###\s+(\d+)\s+(.+?)(?:（(.+)）)?$/);
    if (cardMatch) {
      flush();
      current = {
        id: `bk-${cardMatch[1].padStart(3, "0")}`,
        word: cardMatch[2].trim(),
        reading: cardMatch[3]?.trim(),
        category,
      };
      continue;
    }

    if (line.startsWith("## ")) {
      flush();
      // Strip leading emoji / punctuation from the category heading
      category = line.slice(3).replace(/^[^\p{L}\p{N}]+/u, "").trim();
      continue;
    }

    const fieldMatch = line.match(/^- \*\*(.+?)\*\*：(.*)$/);
    if (fieldMatch && current) {
      const [, label, value] = fieldMatch;
      if (label === "干扰提示") {
        current.decoyHints = value.split("／").map(s => s.trim()).filter(Boolean);
      } else if (FIELD_KEYS[label]) {
        (current as Record<string, unknown>)[FIELD_KEYS[label]] = value.trim();
      }
    }
  }
  flush();

  return cards;
}

function isCompleteCard(card: Partial<BluffCard>): card is BluffCard {
  return Boolean(
    card.id &&
    card.word &&
    card.explanation &&
    card.firstHalf &&
    card.explanation.startsWith(card.firstHalf) &&
    card.trueHint &&
    card.decoyHints &&
    card.decoyHints.length >= 2
  );
}
