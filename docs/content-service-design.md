# 题库服务（Content Service）设计方案

> 适用游戏：谁是卧底、谁是瞎掰王（以及以后依赖题库的游戏）
> 状态：P0 开发中（分支 `feature/content-service`）

## 1. 目标

把题库从「静态文件」升级成一个持续进化的服务：

1. **内容**：题目带 metadata（分类、难度、出处、状态），题目之间有关系（相似、同组、互斥、递进）。
2. **数据**：记录每一轮出了哪道题、玩得怎么样，并收集玩家反馈。
3. **选题**：根据数据和关系选题，让好题多出、烂题被发现、一局里的题目搭配得更好。

## 2. 设计原则

- **游戏优先，题库服务不能拖垮游戏。** 数据库打不开、写入失败时只打日志，游戏照常进行；选题能回退到文件题库。
- **先积累数据。** 选题算法随时可以改，没记下来的数据补不回来。
- **不收集个人信息。** 只用浏览器里随机生成的玩家 ID。
- **题目文本可审阅。** 改题走 git PR，有审阅也有历史。

## 3. 存储方案

**SQLite 文件 + Fly Volume。**

- 服务本来只能跑 1 台机器（房间状态在内存里），单文件数据库刚好合适：零运维，查询就是本地调用，成本约 $0.15/GB/月。
- 使用 Node 内置的 `node:sqlite`，不需要编译原生模块，Docker 镜像不用装编译工具。
- Fly 默认每天给 Volume 做快照（保留 5 天），作为基础备份。
- Volume 会把机器固定在这块盘上，等于在平台层面强制单机，和现有限制一致。
- **什么时候换托管数据库（Supabase/Postgres）**：多人同时编辑题库，或需要现成的数据后台时。表结构可以直接迁移。

**内容源采用混合方案：**

| 数据 | 以哪里为准 | 说明 |
|---|---|---|
| 题目文本、metadata、关系 | git 里的文件（`docs/word-list.md`、`docs/bluff-list.md`，以后可改 YAML） | 走 PR 审阅；服务启动时同步进数据库 |
| 使用记录、反馈、统计 | 数据库 | 只在数据库里 |

题量上来、有非技术同事参与时，再做后台编辑界面，并把「以哪里为准」切到数据库。

## 4. 数据结构

### 4.1 稳定 ID

每张卡有一个永不改变的 ID，数据和反馈都挂在这个 ID 上：

- 谁是卧底：`uc-<序号>`，序号来自 `word-list.md` 第一列，如 `uc-001`。
- 谁是瞎掰王：`bk-<编号>`，编号来自 `bluff-list.md` 的 `### 01` 标题，如 `bk-001`。

**规则：已有编号永远不改、不复用；新题往后追加；不再使用的题标为下架，不要删除。**

### 4.2 内容层（P0 先建 `cards`，其余在 P1/P2 加）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `cards` | id, game, title, category, content(JSON), status, first_seen_at, updated_at | P0：从文件同步过来的题目快照 |
| `terms` | id, text, reading, category, difficulty, locale, status（草稿/上线/下架）, source_url, tags | P2：「词」作为独立实体 |
| `term_relations` | term_a, term_b, type, weight | P2：词和词之间的关系 |
| `undercover_pairs` | id, civilian_term, spy_term, similarity | P2：卧底词对引用两个词 |
| `bluff_cards` | id, term_id, explanation, first_half, true_hint, decoys, verified_by | P2 |
| `packs`、`pack_items` | name, theme, game, 顺序 | P1：题包，如「春节」「打工人」「冷门动物」 |

关系类型：

| 类型 | 用途 |
|---|---|
| `similar` | 相近，卧底词对的候选来源；同一局里避免出太像的题 |
| `same_family` | 同一类，用于成组出题 |
| `avoid_together` | 不要在同一局出现 |
| `follow_up` | 适合接在后面出（难度递进、主题延续） |

### 4.3 数据层（P0）

**`rounds`**：每一轮一条记录。

| 字段 | 说明 |
|---|---|
| id, room_id, game, card_id, created_at | |
| round_no, mode | 瞎掰王第几轮、哪种模式 |
| player_count, speaker_count, guesser_count | |
| skipped | 房主是否「换一题」 |
| outcome(JSON) | 卧底：胜方、进行轮数、卧底人数；瞎掰王：猜中老实人的票数、总票数、老实人是否看完被锁定、瞎掰王得票分布 |

**`feedback`**：玩家主动反馈。

| 字段 | 说明 |
|---|---|
| id, card_id, game, room_id, player_id, created_at | player_id 是匿名随机 ID |
| rating | +1 / -1 |
| reasons | 可选标签：`too_hard`、`too_easy`、`never_heard`、`funny`、`boring` |

同一个玩家对同一轮的同一张卡只保留最后一次反馈。

## 5. 什么算「效果好」

被动信号为主，主动打分为辅（聚会里很少有人愿意专门打分）。

| 信号 | 谁是卧底 | 谁是瞎掰王 |
|---|---|---|
| 换题率 | （大厅里「换一组」发生在开局前，P1 再记） | 「换一题」：有人认识这个词，或者觉得没意思 |
| 平衡度 | 卧底胜率接近 50% 最好：太高说明两个词太像，太低说明差别太大 | 猜中老实人的比例在 30%–60% 最好：太高说明解释太好猜 |
| 节奏 | 几轮就找出卧底，说明区分度太明显 | 票数分散、有人被骗，说明悬念足 |
| 主动反馈 | 揭晓时 👍/👎 | 同左 |

**打分方法**：用有置信度的分数（Wilson 下限），避免样本很少的新题因为偶然全是好评而排到最前。平衡度按与理想区间的距离扣分。

## 6. 选题逻辑（P1）

1. **过滤**：只取已上线的、当前游戏的题；按房主选的题包或难度筛选；排除本局出过的题，以及在座玩家最近见过的题。
2. **加权**：效果分越高，被抽中的概率越大；同时保留约 20% 的探索概率给新题和数据少的题，否则新题永远攒不到数据。
3. **关系调整**：和本局已出题目是 `avoid_together` 或高度 `similar` 的降权；选了题包时按包内顺序或 `follow_up` 关系出题；卧底词对可以从 `similar` 关系自动组合出新候选，进入草稿状态等审核。

## 7. 接口设计

游戏内交互走 socket，管理功能走 REST（与项目约定一致）。

**游戏引擎内部**：统一的内容模块，替代现在的 `loadWordPairs()` 和 `loadBluffCards()`。

```ts
interface ContentService {
  pickCard(opts: { game; packId?; difficulty?; excludeIds; playerIds }): Card; // P1
  recordRound(event: RoundEvent): void;     // P0
  recordFeedback(fb: Feedback): void;       // P0
}
```

**玩家反馈**：socket 事件 `GameEvents.SUBMIT_FEEDBACK`（P0）。

**管理接口**（REST，用 `ADMIN_TOKEN` 鉴权，未设置 token 时接口关闭）：

| 接口 | 阶段 |
|---|---|
| `GET /api/v1/admin/stats?game=` 每张卡的使用次数、换题率、平衡度、好评率 | P0（只读 JSON） |
| `GET/POST/PATCH /api/v1/admin/terms`、`/pairs`、`/bluff-cards`、`/packs`、`/relations` | P2 |
| `POST /api/v1/admin/import` 批量导入 | P2 |

**AI 辅助出题**（P2）：批量生成草稿，人工审核后上线。瞎掰王的解释必须准确，`source_url` 必填，审核时对照出处核实。

## 8. 落地阶段

| 阶段 | 内容 | 得到什么 |
|---|---|---|
| **P0** | 稳定 ID；SQLite + Volume；记录每轮使用情况和换题；揭晓时 👍/👎；只读统计接口 | 开始积累数据 |
| **P1** | 效果分 + 加权选题；题包；后台统计页；记录卧底大厅里的「换一组」 | 题目质量开始自动变好 |
| **P2** | 后台编辑界面；关系图谱；AI 生成草稿 + 审核流程 | 题库持续扩充，非技术同事可参与 |

## 9. 功能开关与上线

整个题库服务由一个写死在代码里的开关控制：`backend/src/config/features.ts` 里的 `contentService`。

| 环境 | 判断方式 | 默认 |
|---|---|---|
| development（本地开发服务器） | `NODE_ENV` 不是 `production` | **开** |
| production（Fly 线上） | `NODE_ENV=production`（Dockerfile 和 fly.toml 都已设置） | **关** |

**开关关闭时**：不加载 SQLite、不读写任何文件、不记录数据；揭晓时不显示 👍/👎；统计接口返回 404；不需要 Volume。游戏和题库与 P0 之前完全一样（静态题库文件）。

**本地测试**：直接 `npm run dev:backend`，开关默认打开，数据库写在 `backend/data/overcover.db`（已加入 `.gitignore`）。

**在线上打开时**（以后需要时）：

1. 把 `features.ts` 里 `contentService` 的 `production` 改为 `true`。
2. 创建 Volume（只需一次）：`fly volumes create overcover_data --region syd --size 1`
3. 在 `fly.toml` 里取消注释 `DATA_DIR` 和 `[mounts]`。
4. （可选）设置统计接口的 token：`fly secrets set ADMIN_TOKEN=<随机字符串>`
5. 部署。数据库文件为 `/data/overcover.db`。

其他说明：

- Docker 镜像从 Node 20 升级到 Node 22（`node:sqlite` 需要 Node 22；Node 20 已于 2026 年 4 月停止维护）。开关打开时启动日志里会有一行 SQLite 的 `ExperimentalWarning`，属正常现象。
- 挂载 Volume 后，app 只能运行 1 台机器（Volume 只能挂在一台机器上），正好满足房间状态在内存里的限制。
- 数据库打不开时（例如 Volume 没挂上），服务会打日志并照常运行游戏，只是不记录数据。
- 查看统计：`curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<app>.fly.dev/api/v1/admin/stats?game=BLUFF_KING`

## 10. 待决定

- 谁来维护题库：只有一个人时用「git 文件为准」最简单；多人编辑时 P1 就要做后台编辑，并考虑换成托管数据库。
- 主动反馈的位置和形式：P0 先做每轮揭晓时一排 👍/👎 加可选原因标签。
