/**
 * One metered scenario judge call. Verdict: each criterion is routed alone as a `scenario_judge`
 * question, and those reaching an LLM leg share one send of the judge's own verdict call. Turn
 * decision: the judge's own call on the table's decision backend, never routed. One priced fact.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import {
  INSTANT_EVAL_SCENARIO_DECISION_TOOLS,
  INSTANT_EVAL_SCENARIO_JUDGE_SPEND_MODEL,
  InstantEvalJudgeStoppedError,
  isInstantEvalJudgeLlmBackend,
  isInstantEvalJudgeLlmKind,
  isInstantEvalSpendBillable,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgement,
  type InstantEvalScenarioCriterionResult,
  type InstantEvalScenarioJudgeAnswer,
  type InstantEvalScenarioJudgeCall,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";

import type { InstantEvalRateLimiter } from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalLlmJudgeChannel } from "../channels/instant-eval-llm-judge.channel.ts";
import { instantEvalJudgeSpendAfterCall } from "../rules/instant-eval-judge-route-cost.rules.ts";
import {
  instantEvalJudgeLlmCallPermitOf,
  instantEvalJudgeScenarioDecisionBackendsOf,
} from "../rules/instant-eval-judge-route.rules.ts";
import {
  instantEvalScenarioCriterionResultOf,
  instantEvalScenarioQuestionOf,
  instantEvalScenarioTextOf,
} from "../rules/instant-eval-scenario-judge.rules.ts";
import type { InstantEvalJudgeRouterService } from "./instant-eval-judge-router.service.ts";
import type { InstantEvalJudgeService } from "./instant-eval-judge.service.ts";
import { InstantEvalScenarioLlmVerdictService } from "./instant-eval-scenario-llm-verdict.service.ts";

const defaultLogger: Logger = createLogger("langwatch:instant-eval-judge:scenario-judge");

/** Criteria routed at once; each is one decision request, so a long list is paced. */
const MAX_PARALLEL_CRITERIA = 8;

type InstantEvalScenarioJudgeServiceDeps = Readonly<{
  /** Admits the call and records its one priced fact, as it does for a judge call. */
  judge: InstantEvalJudgeService;
  router: InstantEvalJudgeRouterService;
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
  logger?: Pick<Logger, "error">;
}>;

type Spend = { inputTokens: number; costNanoUsd: number };
type Payer = Readonly<{ organizationId: string; projectId: string }>;
type CriterionOutcome = Readonly<{ key: string; result: InstantEvalScenarioCriterionResult }>;

export class InstantEvalScenarioJudgeService {
  private readonly logger: Pick<Logger, "error">;

  private constructor(private readonly deps: InstantEvalScenarioJudgeServiceDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: InstantEvalScenarioJudgeServiceDeps): InstantEvalScenarioJudgeService {
    return new InstantEvalScenarioJudgeService(deps);
  }

  async judge(call: InstantEvalScenarioJudgeCall): Promise<InstantEvalScenarioJudgeAnswer> {
    const { projectId } = call;
    const admission = await this.deps.judge.admit({ projectId, isRouted: true });
    if (admission.outcome === "refused") return admission;
    const payer = { organizationId: admission.organizationId, projectId };
    return call.phase === "verdict"
      ? this.verdict({ call, payer })
      : this.decision({ call, payer });
  }

  private async verdict({
    call,
    payer,
  }: {
    call: InstantEvalScenarioJudgeCall;
    payer: Payer;
  }): Promise<InstantEvalScenarioJudgeAnswer> {
    const { projectId, criteria, llmCall, signal, requestKey } = call;
    const text = instantEvalScenarioTextOf(call);
    const verdicts = InstantEvalScenarioLlmVerdictService.create({
      llmJudge: this.deps.llmJudge,
      limiter: this.deps.limiter,
      projectId,
      llmCall,
      signal,
      logger: this.logger,
    });
    const settled = await settledInBatches({
      items: criteria,
      size: MAX_PARALLEL_CRITERIA,
      run: ({ key, text: criterion }) =>
        this.deps.router.classify({
          projectId,
          text,
          questions: [instantEvalScenarioQuestionOf({ key, text: criterion })],
          route: { job: "scenario_judge" },
          scenario: { criterionKey: key, criterionText: criterion, verdicts },
          ...(signal ? { signal } : {}),
        }),
    });
    const spend = spendOf(settled);
    const failure = settled.find((one) => one.status === "rejected");
    if (signal?.aborted && failure) {
      await this.recordStop({ payer, spend, requests: criteria.length });
      throw failure.reason;
    }
    const outcomes = criteria.map(({ key }, at) =>
      this.criterionOutcome({ key, part: settled[at] }),
    );
    const priceUsd = await this.record({ payer, requestKey, spend, requests: criteria.length });
    const isAnswered = settled.some(
      (one) => one.status === "fulfilled" && one.value.verdicts.length > 0,
    );
    if (criteria.length > 0 && !isAnswered) return { outcome: "unavailable" };
    const reasoning = sharedCallReasoningOf({ settled, verdicts });
    return {
      outcome: "judged",
      phase: "verdict",
      criteria: outcomes,
      ...(reasoning ? { reasoning } : {}),
      inputTokens: spend.inputTokens,
      priceUsd,
    };
  }

  /** A criterion whose routed call threw is unanswered, so inconclusive; the others stand. */
  private criterionOutcome({
    key,
    part,
  }: {
    key: string;
    part: PromiseSettledResult<InstantEvalJudgement> | undefined;
  }): CriterionOutcome {
    if (part?.status !== "fulfilled") {
      this.logger.error(
        { error: part?.reason },
        "Instant Evals scenario criterion could not be routed; it is reported inconclusive",
      );
      return { key, result: "inconclusive" };
    }
    return { key, result: instantEvalScenarioCriterionResultOf(part.value.verdicts[0]) };
  }

  /**
   * The judge's own go-on-or-judge call on the table's decision backend, then its enabled
   * fallbacks. A table that names none answers no turn decision; a backend that fails or answers
   * unreadably lets the conversation go on, since the judge's last turn forces the verdict.
   */
  private async decision({
    call,
    payer,
  }: {
    call: InstantEvalScenarioJudgeCall;
    payer: Payer;
  }): Promise<InstantEvalScenarioJudgeAnswer> {
    const candidates = this.decisionBackends();
    if (candidates.length === 0) return { outcome: "unavailable" };
    const spend: Spend = { inputTokens: 0, costNanoUsd: 0 };
    let decision: "continue" | "verdict" = "continue";
    try {
      for (const backend of candidates) {
        const tool = await this.askDecision({ backend, call, spend });
        if (tool === undefined) continue;
        decision = tool === INSTANT_EVAL_SCENARIO_DECISION_TOOLS.verdict ? "verdict" : "continue";
        break;
      }
    } catch (error) {
      if (!call.signal?.aborted) throw error;
      await this.recordStop({ payer, spend, requests: 1 });
      throw error;
    }
    const { requestKey } = call;
    const priceUsd = await this.record({ payer, requestKey, spend, requests: 1 });
    return {
      outcome: "judged",
      phase: "decision",
      decision,
      inputTokens: spend.inputTokens,
      priceUsd,
    };
  }

  /** Whether a turn decision can be asked at all; without one every run fails at its first turn. */
  isConfigured(): boolean {
    return this.decisionBackends().length > 0;
  }

  /** The decision backend and its enabled fallbacks that can take the judge's own tool call. */
  private decisionBackends(): string[] {
    const { table } = this.deps;
    return instantEvalJudgeScenarioDecisionBackendsOf(table).filter((name) =>
      isInstantEvalJudgeLlmBackend({ backend: name, table }),
    );
  }

  /** One backend's decision tool, billed into `spend`; undefined when it gave none. */
  private async askDecision({
    backend,
    call,
    spend,
  }: {
    backend: string;
    call: InstantEvalScenarioJudgeCall;
    spend: Spend;
  }): Promise<string | undefined> {
    const config = this.deps.table.backends[backend];
    const { projectId, signal, llmCall } = call;
    const { system, user } = llmCall;
    const offered: readonly string[] = Object.values(INSTANT_EVAL_SCENARIO_DECISION_TOOLS);
    const tools = llmCall.tools.filter((tool) => offered.includes(tool.name));
    if (!config?.model || tools.length === 0) return void 0;
    if (!isInstantEvalJudgeLlmKind(config.kind)) return void 0;
    try {
      await this.deps.limiter.acquire(
        instantEvalJudgeLlmCallPermitOf({ projectId, system, user }),
        signal,
      );
      const answer = await this.deps.llmJudge.call(
        {
          wire: config.kind,
          model: config.model,
          timeoutMs: config.timeoutMs,
          ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
          ...(config.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: config.maxOutputTokens }),
          system,
          user,
          tools,
        },
        ...(signal ? [signal] : []),
      );
      this.pay({ backend, spend, ...answer });
      return answer.outcome === "answered" ? answer.tool : void 0;
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.error({ error }, "Instant Evals scenario turn decision call threw");
      return void 0;
    }
  }

  private pay({
    backend,
    spend,
    inputTokens,
    outputTokens,
  }: {
    backend: string;
    spend: Spend;
    inputTokens: number;
    outputTokens: number;
  }): void {
    const { pricing } = this.deps;
    const after = instantEvalJudgeSpendAfterCall({
      spend,
      backend,
      inputTokens,
      outputTokens,
      pricing,
    });
    Object.assign(spend, after.spend);
    if (!after.isUnpriced) return;
    // Boot refuses a table whose decision backend has no price: a bug, not a deploy slip.
    this.logger.error({ backend }, "Instant Evals scenario judge called a backend with no price");
  }

  /** The judgement's one priced fact; nothing billed records nothing and costs nothing. */
  private async record({
    payer,
    requestKey,
    spend,
    requests,
  }: {
    payer: Payer;
    requestKey?: string | undefined;
    spend: Spend;
    requests: number;
  }): Promise<number> {
    if (!isInstantEvalSpendBillable(spend)) return 0;
    return this.deps.judge.priceAndRecord({
      ...payer,
      requestKey,
      ...spend,
      model: INSTANT_EVAL_SCENARIO_JUDGE_SPEND_MODEL,
      requests,
    });
  }

  /**
   * A caller's stop after paid legs is recorded under a freshly minted request id, never the retry
   * key, so the retry that completes under the key keeps its own row.
   */
  private async recordStop({
    payer,
    spend,
    requests,
  }: {
    payer: Payer;
    spend: Spend;
    requests: number;
  }): Promise<void> {
    try {
      await this.record({ payer, spend, requests });
    } catch (error) {
      this.logger.error(
        { error, ...payer, ...spend },
        "Instant Evals scenario judge could not record a stopped call's paid legs",
      );
    }
  }
}

/**
 * The shared call's explanation when one backend answered every criterion, else empty: a
 * criterion settled by another leg could contradict it.
 */
function sharedCallReasoningOf({
  settled,
  verdicts,
}: {
  settled: readonly PromiseSettledResult<InstantEvalJudgement>[];
  verdicts: InstantEvalScenarioLlmVerdictService;
}): string {
  const backends = new Set<string>();
  for (const one of settled) {
    if (one.status !== "fulfilled") return "";
    const [backend, ...others] = Object.keys(one.value.routing?.answeredBy ?? {});
    if (backend === undefined || others.length > 0) return "";
    backends.add(backend);
  }
  const [sole, ...more] = [...backends];
  return sole === undefined || more.length > 0 ? "" : verdicts.explanationOf(sole);
}

/** What every criterion's legs paid, a stopped one's included, so a stop still bills them. */
function spendOf(settled: readonly PromiseSettledResult<InstantEvalJudgement>[]): Spend {
  const spend: Spend = { inputTokens: 0, costNanoUsd: 0 };
  for (const one of settled) {
    const paid = one.status === "fulfilled" ? one.value : stoppedSpendOf(one.reason);
    spend.inputTokens += paid.inputTokens;
    spend.costNanoUsd += paid.costNanoUsd ?? 0;
  }
  return spend;
}

function stoppedSpendOf(reason: unknown): { inputTokens: number; costNanoUsd?: number } {
  return reason instanceof InstantEvalJudgeStoppedError ? reason : { inputTokens: 0 };
}

/** Every item's settled result in order, `size` running at a time. */
async function settledInBatches<T, R>({
  items,
  size,
  run,
}: {
  items: readonly T[];
  size: number;
  run: (item: T) => Promise<R>;
}): Promise<PromiseSettledResult<R>[]> {
  const settled: PromiseSettledResult<R>[] = [];
  for (let at = 0; at < items.length; at += size) {
    settled.push(...(await Promise.allSettled(items.slice(at, at + size).map(run))));
  }
  return settled;
}
