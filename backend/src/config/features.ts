/**
 * Hard-coded feature toggles, per environment.
 *
 * "production" is NODE_ENV=production (set in the Dockerfile and fly.toml);
 * everything else, including the local dev server, counts as "development".
 * To change a toggle, edit the value here and redeploy.
 */

type Env = "development" | "production";

const ENV: Env = process.env.NODE_ENV === "production" ? "production" : "development";

const FEATURES = {
  /**
   * Card bank data service: SQLite content store, round logging, 👍/👎 feedback
   * and the admin stats endpoint. When off, games run exactly as before on the
   * static card files, nothing is written, and no Fly volume is needed.
   */
  contentService: { development: true, production: false },
} satisfies Record<string, Record<Env, boolean>>;

export type FeatureName = keyof typeof FEATURES;

export function isFeatureEnabled(name: FeatureName): boolean {
  return FEATURES[name][ENV];
}
