/**
 * What one scenario run cost: the harness's own model tokens (simulator,
 * judge), counted by an AI SDK middleware, and Langy's spend on its gateway
 * key, read from `gatewayUsage.summary` before and after the run.
 */

import type { GatewayUsageSummary } from "@langwatch/gateway-contract";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

import { getSessionCookie, trpcQuery } from "./trpc";

/** The model `wrapLanguageModel` takes: what `openai("gpt-5-mini")` returns. */
type HarnessModel = Parameters<typeof wrapLanguageModel>[0]["model"];

/** The part of a V3 usage report the meter reads. */
interface ReportedUsage {
  inputTokens: { total: number | undefined };
  outputTokens: { total: number | undefined };
}

/** One role's tokens since the run started. */
export interface TokenTally {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Langy's gateway spend over a fixed window, as the Usage page totals it. */
export interface LangyUsage {
  usd: number;
  requests: number;
}

/** Reads Langy's spend in one organization over `[from, to)`. */
export type LangyUsageReader = (input: {
  organizationId: string;
  from: Date;
  to: Date;
}) => Promise<LangyUsage>;

/** The hooks `runScenarioAndLog` calls around a run. */
export interface ScenarioCost {
  /** Zeroes the harness tallies and records Langy's spend so far. */
  start(): Promise<void>;
  /** One transcript line for everything since `start`. Never throws. */
  line(): Promise<string>;
}

export interface CostMeter extends ScenarioCost {
  /** The same model, with every call's tokens added to `role`'s tally. */
  wrap(model: HarnessModel, role: string): HarnessModel;
  /** Meter Langy's gateway key in this organization from the next `start` on. */
  watchLangy(input: { organizationId: string }): void;
  tallies(): Record<string, TokenTally>;
}

/** The display name `LangyVirtualKeyGatewayService` mints Langy's per-project key under. */
const LANGY_KEY_NAME = "Langy";

/** Wide enough on both sides to absorb clock skew; the before/after delta removes older spend. */
const LANGY_WINDOW_MS = 24 * 3_600_000;

/** Builds a meter that tallies harness model tokens and Langy's gateway spend per run. */
export function createCostMeter({
  readLangyUsage = readLangyGatewayUsage,
}: { readLangyUsage?: LangyUsageReader } = {}): CostMeter {
  let tallies: Record<string, TokenTally> = {};
  let organizationId: string | null = null;
  let langyBefore: { window: { from: Date; to: Date }; usage: LangyUsage } | Error | null = null;

  const add = (role: string, usage: ReportedUsage | undefined): void => {
    const tally = (tallies[role] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
    tally.calls += 1;
    tally.inputTokens += usage?.inputTokens.total ?? 0;
    tally.outputTokens += usage?.outputTokens.total ?? 0;
  };

  const langyPart = async (): Promise<string> => {
    if (!organizationId || !langyBefore) return "Langy not metered";
    if (langyBefore instanceof Error) return `Langy unavailable (${langyBefore.message})`;
    try {
      const after = await readLangyUsage({ organizationId, ...langyBefore.window });
      const usd = after.usd - langyBefore.usage.usd;
      const requests = after.requests - langyBefore.usage.requests;
      return `Langy $${usd.toFixed(4)} over ${requests} gateway requests`;
    } catch (error) {
      return `Langy unavailable (${errorMessage(error)})`;
    }
  };

  return {
    wrap: (model, role) =>
      wrapLanguageModel({ model, middleware: countingMiddleware((usage) => add(role, usage)) }),
    watchLangy: (input) => {
      organizationId = input.organizationId;
    },
    tallies: () => structuredClone(tallies),
    start: async () => {
      tallies = {};
      langyBefore = null;
      if (!organizationId) return;
      const now = Date.now();
      const window = { from: new Date(now - LANGY_WINDOW_MS), to: new Date(now + LANGY_WINDOW_MS) };
      try {
        langyBefore = { window, usage: await readLangyUsage({ organizationId, ...window }) };
      } catch (error) {
        langyBefore = new Error(errorMessage(error));
      }
    },
    line: async () => `${formatTallies(tallies)}; ${await langyPart()}`,
  };
}

function countingMiddleware(
  add: (usage: ReportedUsage | undefined) => void,
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      add(result.usage);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const counted = stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === "finish") add(part.usage);
            controller.enqueue(part);
          },
        }),
      );
      return { stream: counted, ...rest };
    },
  };
}

function formatTallies(tallies: Record<string, TokenTally>): string {
  const roles = Object.entries(tallies);
  if (roles.length === 0) return "harness made no model calls";
  return roles
    .map(
      ([role, { calls, inputTokens, outputTokens }]) =>
        `${role} ${calls} calls, ${inputTokens} input and ${outputTokens} output tokens`,
    )
    .join("; ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Langy's key alone, not the organization's total: a scenario may mint keys
 * of its own. The summary is in dollars and requests; it carries no tokens.
 */
export const readLangyGatewayUsage: LangyUsageReader = async ({ organizationId, from, to }) => {
  const summary = await trpcQuery<GatewayUsageSummary>({
    cookie: await getSessionCookie(),
    path: "gatewayUsage.summary",
    input: { organizationId, fromDate: from.toISOString(), toDate: to.toISOString() },
  });
  const langyKeys = summary.byVirtualKey.filter((key) => key.name === LANGY_KEY_NAME);
  // The key is minted on first use, so its id is unknown at `start`;
  // a second match would be another key's spend.
  if (langyKeys.length > 1) {
    throw new Error(
      `${langyKeys.length} gateway keys are named "${LANGY_KEY_NAME}" in this organization; spend cannot be attributed to Langy's`,
    );
  }
  return {
    usd: langyKeys.reduce((sum, key) => sum + Number(key.totalUsd), 0),
    requests: langyKeys.reduce((sum, key) => sum + key.requests, 0),
  };
};
