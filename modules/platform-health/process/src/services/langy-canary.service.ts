import { generate } from "@langwatch/ksuid";
/** The Langy canary, ported from main's `health-probes/langy-canary.service.ts`. */
import type { LangyApi, LangyCredentialSession, LangyKeyCaller } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  classifyLangyCanaryOutcome,
  LANGY_CANARY_BUDGET_MS,
  LANGY_CANARY_GREETING,
  langyCanaryAnswer,
  type LangyCanaryOutcome,
  type LangyCanaryResult,
} from "../rules/langy-canary.rules.ts";

const logger = createLogger("langwatch:langy-canary");

export type LangyCanaryPeers = Pick<
  LangyApi,
  "getRestCaller" | "getRestActor" | "startConversationTurn" | "awaitTurnSettlement"
>;

export type LangyCanaryClock = Readonly<{ now: () => number; budgetMs: number }>;

const REAL_CLOCK: LangyCanaryClock = {
  now: () => nowInstant().epochMilliseconds,
  budgetMs: LANGY_CANARY_BUDGET_MS,
};

/** Hono's own 404, byte-for-byte what an unmounted path returns: a dark surface reveals nothing. */
const darkNotFound = (): Response =>
  new Response("404 Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
  });

function abortedPromise(signal: AbortSignal): Promise<{ aborted: true }> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ aborted: true });
    signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
  });
}

/**
 * Sends one real greeting turn as the key's owner and holds until it settles, inside one budget.
 * Single flight per caller; a `timeout` keeps the caller's slot one further budget, because the
 * abandoned turn is still running (specs/platform-health.feature).
 */
export class LangyCanaryService {
  readonly #inFlight = new Map<string, Promise<LangyCanaryOutcome>>();
  readonly #reservedUntil = new Map<string, number>();

  private constructor(
    private readonly langy: LangyCanaryPeers,
    private readonly clock: LangyCanaryClock,
  ) {}

  static create(options: {
    langy: LangyCanaryPeers;
    clock?: LangyCanaryClock;
  }): LangyCanaryService {
    return new LangyCanaryService(options.langy, options.clock ?? REAL_CLOCK);
  }

  async probe(key: LangyKeyCaller): Promise<Response> {
    const caller = await this.langy.getRestCaller({ ...key, surface: "turns" });
    if (caller.dark) return darkNotFound();

    const session = await this.langy.getRestActor({ userId: caller.userId });
    logger.info({ projectId: caller.projectId, userId: session.user.id }, "Running Langy canary");
    // One key per check: a fixed key would replay the first turn's outcome forever.
    const checkId = generate("langycanary").toString();
    const result = await this.#singleFlight({ projectId: caller.projectId, session, checkId });
    const { status, body } = langyCanaryAnswer(result);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  #singleFlight(input: {
    projectId: string;
    session: LangyCredentialSession;
    checkId: string;
  }): Promise<LangyCanaryResult> {
    const key = `${input.projectId}/${input.session.user.id}`;
    if (this.#inFlight.has(key)) return Promise.resolve({ busy: true });

    const reserved = this.#reservedUntil.get(key);
    if (reserved !== undefined) {
      if (this.clock.now() < reserved) return Promise.resolve({ busy: true });
      this.#reservedUntil.delete(key);
    }

    const attempt = this.#run(input)
      .then((outcome) => {
        if (!outcome.healthy && outcome.reason === "timeout") {
          this.#reservedUntil.set(key, this.clock.now() + this.clock.budgetMs);
        }
        return outcome;
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, attempt);
    return attempt;
  }

  async #run({
    projectId,
    session,
    checkId,
  }: {
    projectId: string;
    session: LangyCredentialSession;
    checkId: string;
  }): Promise<LangyCanaryOutcome> {
    const startedAt = this.clock.now();
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), this.clock.budgetMs);
    const aborted = abortedPromise(budget.signal);
    let started: { conversationId: string; turnId: string } | undefined;

    try {
      const startResult = await Promise.race([
        this.langy.startConversationTurn({
          projectId,
          idempotencyKey: checkId,
          session,
          requestedConversationId: null,
          messages: [{ role: "user", parts: [{ type: "text", text: LANGY_CANARY_GREETING }] }],
          isRetry: false,
          turnContext: {},
        }),
        aborted,
      ]);
      if ("aborted" in startResult) {
        return { healthy: false, reason: "timeout", durationMs: this.clock.now() - startedAt };
      }
      started = { conversationId: startResult.conversationId, turnId: startResult.turnId };

      const wait = await Promise.race([
        this.langy.awaitTurnSettlement({
          projectId,
          ...started,
          userId: session.user.id,
          signal: budget.signal,
        }),
        aborted,
      ]);
      const settlement = "kind" in wait && wait.kind === "settled" ? wait.settlement : null;
      return {
        ...classifyLangyCanaryOutcome(settlement),
        ...started,
        durationMs: this.clock.now() - startedAt,
      };
    } catch (error) {
      logger.error({ error, ...started }, "Langy canary could not start or follow its turn");
      return {
        healthy: false,
        reason: "turn_failed",
        ...started,
        durationMs: this.clock.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
