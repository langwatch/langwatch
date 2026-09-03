/**
 * Spec: packages/enterprise/features/governance/specs/governance.feature
 *       ("Anomaly delivery delegates network safety")
 *
 * The spend-spike evaluator was composed by nothing. `startSpendSpikeAnomalyWorker`
 * and `SsrfSafeAnomalyAlertHttpAdapter` had zero callers anywhere in `apps/` or
 * `packages/`, so the whole delivery path — signed body, bounded retries, an
 * auditable outcome per destination — described behaviour no process started.
 * The platform's own root started the loop but built the evaluator over `prisma`
 * alone, which is why a fired alert recorded `log_only` even for an admin who
 * had configured a webhook.
 *
 * What these tests hold is the seam that changed: the fired decision reaches the
 * alert adapter, the adapter's address fence judges the destination BEFORE the
 * transport is reached, and a refused address is recorded as a failed outcome
 * rather than swallowed. The transport is a fake — the fence is the unit under
 * test, and a test that opened a socket would be testing the internet.
 */
import { createHmac } from "node:crypto";
import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkerGovernanceAnomalySchedule,
  WorkerAnomalyAlertTransportPort,
} from "../worker-governance-anomaly.composition";
import { WorkerProductionComposition } from "../worker-production.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";
import { createWorkerProcessDatabase } from "./support/worker-database.double";
import { createWorkerProcessRedis } from "./support/worker-redis.double";

/** The public literal the fence admits without asking DNS anything. */
const PUBLIC_DESTINATION = "https://93.184.216.34/anomalies";
/** A loopback literal: refused by address, again without a DNS round trip. */
const LOOPBACK_DESTINATION = "https://127.0.0.1/anomalies";

const SHARED_SECRET = "S3CR3T";

/** One firing rule: the current window is ten times its own trailing baseline. */
function spendSpikeRuleRow(destinationUrl: string) {
  return {
    id: "rule-1",
    organizationId: "organization-1",
    scope: "organization",
    scopeId: "organization-1",
    name: "Daily spend spike",
    description: null,
    severity: "warning",
    ruleType: "spend_spike",
    thresholdConfig: { windowSec: 3600, ratioVsBaseline: 2, minBaselineUsd: 1 },
    destinationConfig: {
      destinations: [{ type: "webhook", url: destinationUrl, sharedSecret: SHARED_SECRET }],
    },
    status: "active",
    archivedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdById: "user-1",
  };
}

/**
 * The four delegates the evaluator's repository touches, and a promise that
 * settles on the write it makes LAST.
 *
 * The dispatch outcome is recorded by `anomalyAlert.update`, after the alert row
 * exists and after every retry has been spent, so awaiting that call is what
 * makes the assertions deterministic under fake timers rather than a guess about
 * how many microtask turns the chain needs.
 */
function anomalyDatabase(destinationUrl: string) {
  let settle: (detail: Record<string, unknown>) => void = () => void 0;
  const recordedDispatch = new Promise<Record<string, unknown>>((resolve) => {
    settle = resolve;
  });

  const create = vi.fn(async (input: { data: Record<string, unknown> }) => ({
    id: "alert-1",
    triggerWindowStart: input.data.triggerWindowStart as Date,
    triggerWindowEnd: input.data.triggerWindowEnd as Date,
    triggerSpendUsd: input.data.triggerSpendUsd as number,
    triggerEventCount: null,
    detail: input.data.detail as Record<string, unknown>,
    detectedAt: new Date("2026-08-24T12:00:00.000Z"),
  }));
  const update = vi.fn(async (input: { data: { detail: Record<string, unknown> } }) => {
    settle(input.data.detail);
    return { id: "alert-1" };
  });

  return {
    recordedDispatch,
    create,
    update,
    models: {
      anomalyRule: { findMany: vi.fn(async () => [spendSpikeRuleRow(destinationUrl)]) },
      anomalyAlert: { count: vi.fn(async () => 0), create, update },
      project: {
        findFirst: vi.fn(async () => ({ id: "governance-project" })),
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
    },
  };
}

/** A ClickHouse client whose `governance_kpis` window is a tenfold spike. */
function spikeClickHouse() {
  return async () => ({
    insert: async () => undefined,
    query: async () => ({
      json: async () => [{ currentSpend: 100, baselineSpend: 60 }],
    }),
  });
}

/** The network leaf, recorded rather than opened. */
class RecordingTransport extends WorkerAnomalyAlertTransportPort {
  readonly calls: { hostname: string; path: string; init: RequestInit }[] = [];

  async send(
    destination: { hostname: string; path: string },
    init: RequestInit,
  ): Promise<Response> {
    this.calls.push({ hostname: destination.hostname, path: destination.path, init });
    return new Response("", { status: 200, statusText: "OK" });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * One tick, driven forward.
 *
 * The scheduler waits five seconds before its first tick so the process can
 * settle; nine is enough for that tick plus the dispatcher's two backoffs
 * (250ms, then 500ms) and short of the five-second request timeout the
 * dispatcher arms per attempt, so no assertion here depends on an abort.
 */
async function runOneTick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(9_000);
}

describe("createWorkerGovernanceAnomalySchedule", () => {
  describe("given a spend spike rule whose destination is a public address", () => {
    /** @scenario "Anomaly delivery delegates network safety" */
    it("signs the alert body and reaches the transport at the admitted address", async () => {
      vi.useFakeTimers();
      const database = anomalyDatabase(PUBLIC_DESTINATION);
      const transport = new RecordingTransport();

      const schedule = createWorkerGovernanceAnomalySchedule({
        database: database.models,
        resolveClickHouseClient: spikeClickHouse() as never,
        transport,
      });
      schedule.start();
      await runOneTick();
      const detail = await database.recordedDispatch;
      await schedule.stop();

      expect(transport.calls).toHaveLength(1);
      const call = transport.calls[0]!;
      expect(call.hostname).toBe("93.184.216.34");
      expect(call.path).toBe("/anomalies");

      const headers = call.init.headers as Record<string, string>;
      const body = call.init.body as string;
      expect(headers["X-LangWatch-Signature"]).toBe(
        `sha256=${createHmac("sha256", SHARED_SECRET).update(body).digest("hex")}`,
      );
      expect(JSON.parse(body)).toMatchObject({
        ruleId: "rule-1",
        ruleType: "spend_spike",
        severity: "warning",
        organizationId: "organization-1",
        alert: { id: "alert-1" },
      });
      expect(detail).toMatchObject({ dispatch: "dispatched_webhook_1" });
    });
  });

  describe("given a spend spike rule whose destination is a loopback address", () => {
    /**
     * The refusal happens in the composition, above the transport — which is
     * why the assertion is that the transport was never reached at all rather
     * than that it returned an error. A graph that fenced INSIDE the transport
     * would pass a "delivery failed" assertion while still having resolved and
     * dialled a private address.
     */
    /** @scenario "Anomaly delivery delegates network safety" */
    it("never reaches the transport, and records the refusal as the destination's outcome", async () => {
      vi.useFakeTimers();
      const database = anomalyDatabase(LOOPBACK_DESTINATION);
      const transport = new RecordingTransport();

      const schedule = createWorkerGovernanceAnomalySchedule({
        database: database.models,
        resolveClickHouseClient: spikeClickHouse() as never,
        transport,
      });
      schedule.start();
      await runOneTick();
      const detail = await database.recordedDispatch;
      await schedule.stop();

      expect(transport.calls).toHaveLength(0);
      // The alert row is the authoritative signal and survives a refused
      // delivery — dispatch is observability, not the source of truth.
      expect(database.create).toHaveBeenCalledTimes(1);
      expect(detail).toMatchObject({ dispatch: "failed_webhook_1" });
      expect(detail.dispatchOutcomes).toEqual([
        expect.objectContaining({
          destinationIndex: 0,
          type: "webhook",
          status: "failed",
          reason: expect.stringContaining("private or localhost IP addresses"),
        }),
      ]);
    });
  });

  describe("when the schedule is stopped", () => {
    it("runs no further ticks", async () => {
      vi.useFakeTimers();
      const database = anomalyDatabase(LOOPBACK_DESTINATION);

      const schedule = createWorkerGovernanceAnomalySchedule({
        database: database.models,
        resolveClickHouseClient: spikeClickHouse() as never,
        transport: new RecordingTransport(),
      });
      schedule.start();
      await runOneTick();
      await database.recordedDispatch;
      await schedule.stop();
      await vi.advanceTimersByTimeAsync(20 * 60_000);

      expect(database.models.anomalyRule.findMany).toHaveBeenCalledTimes(1);
    });
  });
});

class Handle extends WorkerHandlePort {
  readonly shutdown = vi.fn(async () => undefined);
}

class Transport extends WorkerTransportPort {
  readonly handle = new Handle();
  readonly start = vi.fn(async () => this.handle);
}

class Lifecycle extends WorkerLifecyclePort {
  readonly close = vi.fn(async () => undefined);
}

describe("WorkerProductionComposition", () => {
  describe("when the governance graph is mounted", () => {
    /**
     * The half no unit of the composition can state on its own: that the
     * PRODUCTION root builds the schedule and that mounting governance-events
     * starts it. Composed with a loopback destination, so the assertion needs
     * no transport double and opens no socket — the fence refuses the address
     * and the alert is still written.
     */
    /** @scenario "Anomaly delivery delegates network safety" */
    it("starts the spend spike evaluator over this process's own substrates", async () => {
      vi.useFakeTimers();
      const database = anomalyDatabase(LOOPBACK_DESTINATION);
      const composition = WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        eventing: {
          database: createWorkerProcessDatabase(),
          resolveClickHouseClient: spikeClickHouse() as never,
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(database.models) as never,
      });

      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "governance-events",
      );
      expect(installer, "the composition mounted no governance-events feature").toBeDefined();
      const closer = await installer!.install();
      await runOneTick();

      // Asserted before the dispatch is awaited: a root that composed no
      // schedule leaves that promise pending forever, and a timeout says far
      // less about what went wrong than "the evaluator never read a rule".
      expect(database.models.anomalyRule.findMany).toHaveBeenCalledTimes(1);

      const detail = await database.recordedDispatch;
      expect(closer, "the anomaly schedule's install() returned nothing to stop it").toBeDefined();
      await closer!();

      expect(database.create).toHaveBeenCalledTimes(1);
      expect(detail).toMatchObject({ dispatch: "failed_webhook_1" });
    });
  });
});
