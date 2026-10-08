import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * Two priced events for one request leave one spend row, live and after the judge's spend is
 * rebuilt from its events (ADR-174 decision 13). Subscribers are never replayed by the runtime,
 * so the rebuild here hands the stored events to the subscriber again, over memory and Postgres.
 * A run's and a judged query's spend reach the same total through the judge's recordSpend.
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
  INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION,
  INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
  INSTANT_EVAL_SPEND_MODEL,
  type InstantEvalJudgeSpendPricedEventData,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryInstantEvalRateLimiterChannel } from "../../channels/memory/memory.instant-eval-rate-limiter.channel.ts";
import type { InstantEvalJudgeRepositories } from "../../repositories/instant-eval-judge.repositories.ts";
import { MemoryInstantEvalJudgeRepositories } from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { PostgresInstantEvalJudgeRepositories } from "../../repositories/prisma/prisma.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeFactsService } from "../../services/instant-eval-judge-facts.service.ts";
import { InstantEvalJudgeService } from "../../services/instant-eval-judge.service.ts";
import type { InstantEvalJudgeSpendPricedEvent } from "../instant-eval-judge-spend.commands.ts";
import { buildInstantEvalJudgeSpendPipeline } from "../instant-eval-judge-spend.pipeline.ts";

type SpendRepositories = Pick<InstantEvalJudgeRepositories, "projects" | "usageBilling" | "spend">;

type Backend = Readonly<{
  repositories: () => SpendRepositories;
  /** Empties the judge's spend for the organization, as a rebuild starts from nothing. */
  emptied: () => Promise<SpendRepositories>;
  namespace: () => string;
}>;

const TEN_CENTS_NANO_USD = 100_000_000;
const SEVENTY_FIVE_CENTS_NANO_USD = 750_000_000;
const OCCURRED_AT = Date.UTC(2026, 9, 7);
const SUBSCRIBER = "instantEvalJudgeSpendRow";

function spendCases(backend: Backend): void {
  const organizationId = () => `org_${backend.namespace()}`;

  const pricedFact = (): InstantEvalJudgeSpendPricedEventData => ({
    tenantId: organizationId(),
    occurredAt: OCCURRED_AT,
    organizationId: organizationId(),
    projectId: `project_${backend.namespace()}`,
    requestId: "instantevaljudge_project:evaluation:execution",
    model: INSTANT_EVAL_SPEND_MODEL,
    rateVersion: "instant_eval@0.042x1.3",
    inputTokens: 1_000,
    priceNanoUsd: TEN_CENTS_NANO_USD,
    costNanoUsd: 76_923_077,
  });

  const eventOf = (
    data: InstantEvalJudgeSpendPricedEventData,
    id: string,
  ): InstantEvalJudgeSpendPricedEvent => ({
    id,
    aggregateId: data.organizationId,
    aggregateType: INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
    tenantId: createTenantId(data.tenantId),
    type: INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
    version: INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION,
    createdAt: data.occurredAt,
    occurredAt: data.occurredAt,
    data,
  });

  /** The subscriber as the pipeline declares it, over the given repositories. */
  const subscriberOver = (repositories: SpendRepositories) => {
    const facts = InstantEvalJudgeFactsService.create({ repositories });
    const handled: string[] = [];
    const pipeline = buildInstantEvalJudgeSpendPipeline({
      facts: {
        recordSpend: async (input) => {
          const recorded = await facts.recordSpend(input);
          handled.push(input.requestId);
          return recorded;
        },
      },
    });
    const subscriber = pipeline.eventSubscribers.get(SUBSCRIBER);
    if (!subscriber) throw new Error(`the spend pipeline declares no ${SUBSCRIBER}`);
    const total = async () =>
      (await facts.getSpendTotal({ organizationId: organizationId() })).spendNanoUsd;
    return { pipeline, subscriber, handled, total };
  };

  /** @scenario "Two priced events for one request add one row" */
  it("keeps the request's spend at $0.10 live, and again after a rebuild from its events", async () => {
    const live = subscriberOver(backend.repositories());
    const eventing = new EventSourcing({
      eventStore: EventStoreMemory.createForTesting(),
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const registered = eventing.register(live.pipeline);
    const first = eventOf(pricedFact(), "evt-priced-1");
    const second = eventOf({ ...pricedFact(), occurredAt: OCCURRED_AT + 1_000 }, "evt-priced-2");
    const tenant = { tenantId: createTenantId(organizationId()) };

    await registered.service.storeEvents([first], tenant);
    await registered.service.storeEvents([second], tenant);
    await vi.waitFor(() => expect(live.handled).toHaveLength(2));
    expect(await live.total()).toBe(BigInt(TEN_CENTS_NANO_USD));
    await eventing.close();

    // Replayed over the rows it already holds, and onto an empty table.
    for (const event of [first, second]) {
      await live.subscriber.handle(event, { ...tenant, aggregateId: event.aggregateId });
    }
    expect(await live.total()).toBe(BigInt(TEN_CENTS_NANO_USD));
    const rebuilt = subscriberOver(await backend.emptied());
    expect(await rebuilt.total()).toBe(0n);
    for (const event of [first, second]) {
      await rebuilt.subscriber.handle(event, { ...tenant, aggregateId: event.aggregateId });
    }
    expect(await rebuilt.total()).toBe(BigInt(TEN_CENTS_NANO_USD));
  });

  /** @scenario "A run's and a judged query's spend reach the judge's total" */
  it("counts a run's $0.50 and a judged query's $0.25 as $0.75, reading no project placement", async () => {
    const repositories = backend.repositories();
    const placement = vi.spyOn(repositories.projects, "getPlacement");
    const live = subscriberOver(repositories);
    const eventing = new EventSourcing({
      eventStore: EventStoreMemory.createForTesting(),
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const registered = eventing.register(live.pipeline);
    const judge = InstantEvalJudgeService.create({
      repositories,
      limiter: MemoryInstantEvalRateLimiterChannel.create(),
      classifier: undefined,
      isCloud: true,
      recordSpendPriced: (fact) => registered.commands.recordSpendPriced.send(fact),
      mintRequestId: () => "unused",
      now: () => Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT),
      // A dollar per million tokens at no markup, so the prices come out round.
      pricing: { usdPerMillionInputTokens: 1, markup: 1 },
    });
    const spendOf = ({ requestId, inputTokens }: { requestId: string; inputTokens: number }) => ({
      organizationId: organizationId(),
      projectId: `project_unlearned_${backend.namespace()}`,
      requestId,
      inputTokens,
      requests: 10,
      occurredAt: OCCURRED_AT,
    });

    await judge.recordSpend({
      ...spendOf({ requestId: "instanteval_run-1", inputTokens: 500_000 }),
      runId: "run-1",
    });
    await judge.recordSpend(spendOf({ requestId: "instantevalquery_q1", inputTokens: 250_000 }));
    await vi.waitFor(() => expect(live.handled).toHaveLength(2));

    expect(await live.total()).toBe(BigInt(SEVENTY_FIVE_CENTS_NANO_USD));
    expect(placement).not.toHaveBeenCalled();
    await eventing.close();
  });
}

describe("given the judge's spend pipeline over memory", () => {
  let repositories: SpendRepositories;
  beforeEach(() => {
    repositories = MemoryInstantEvalJudgeRepositories.create();
  });

  spendCases({
    repositories: () => repositories,
    emptied: async () => {
      repositories = MemoryInstantEvalJudgeRepositories.create();
      return repositories;
    },
    namespace: () => "memory",
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("instant-eval-judge-spend-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the judge's spend pipeline over Postgres", () => {
  const namespace = randomUUID();
  const clean = () =>
    cleanupTestRows(database(), [
      ["instantEvalJudgeSpend", { organizationId: `org_${namespace}` }],
    ]);
  const repositories = () => PostgresInstantEvalJudgeRepositories.create({ prisma: database() });

  beforeEach(clean);
  afterAll(clean);

  spendCases({
    repositories,
    emptied: async () => {
      await clean();
      return repositories();
    },
    namespace: () => namespace,
  });
});
