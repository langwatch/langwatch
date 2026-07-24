/**
 * Single source of truth for resolving the LangWatch control-plane URL
 * across the CLI. Replaces the previous three drifted readers
 * (`endpoint.ts:getEndpoint`, `governance/config.ts:defaults`, and the
 * inline `process.env.LANGWATCH_ENDPOINT ?? ...` literal in
 * `commands/status.ts`) so every command sees the same value for the
 * same inputs.
 *
 * Priority (highest wins):
 *   1. opts.flag           — per-command override (e.g. `langwatch login --endpoint <url>`)
 *   2. LANGWATCH_ENDPOINT  — env var (CI / scripts)
 *   3. persisted config    — `~/.langwatch/config.json:control_plane_url` (daily driver)
 *   4. DEFAULT_ENDPOINT    — `https://app.langwatch.ai` (cloud default)
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { loadConfig } from "./config";

export interface ResolveEndpointOptions {
  /** Per-command override flag value (e.g. `--endpoint`). NULL/empty ignored. */
  flag?: string | null;
  /** Optional pre-loaded config to reuse (skips disk read). */
  cfg?: ReturnType<typeof loadConfig>;
}

export interface ResolvedEndpoint {
  /** The resolved URL with trailing slashes stripped. */
  url: string;
  /** Where the value came from — useful for `langwatch config list`. */
  source: "flag" | "env" | "config" | "default";
}

/**
 * Resolve the control-plane endpoint per the documented priority order.
 *
 * Returns both the resolved URL and the source that won, so
 * `langwatch config list` can show the user where each value came from.
 */
export function resolveControlPlaneEndpoint(
  opts: ResolveEndpointOptions = {},
): ResolvedEndpoint {
  if (opts.flag) {
    return { url: stripTrailingSlash(opts.flag), source: "flag" };
  }
  const env = process.env.LANGWATCH_ENDPOINT;
  if (env && env.trim() !== "") {
    return { url: stripTrailingSlash(env), source: "env" };
  }
  // Reading the config involves disk I/O; only do it if we need to.
  // Callers that already have a cfg in scope can pass it in to skip.
  let cfg = opts.cfg;
  if (cfg === undefined) {
    try {
      cfg = loadConfig();
    } catch {
      cfg = undefined;
    }
  }
  // The persisted control_plane_url is populated EITHER by a prior
  // `langwatch login --device` (snapshot of env at save time) OR by an
  // explicit `langwatch config set endpoint <url>`. If it differs from
  // the hardcoded default, treat it as a user choice.
  const persisted = cfg?.control_plane_url;
  if (persisted && persisted !== DEFAULT_ENDPOINT) {
    return { url: stripTrailingSlash(persisted), source: "config" };
  }
  return { url: stripTrailingSlash(DEFAULT_ENDPOINT), source: "default" };
}

/**
 * Convenience for callers that just want the URL string and don't need
 * the source-attribution. Equivalent to
 * `resolveControlPlaneEndpoint(opts).url`.
 */
export function resolveControlPlaneUrl(
  opts: ResolveEndpointOptions = {},
): string {
  return resolveControlPlaneEndpoint(opts).url;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
