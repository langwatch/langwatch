/**
 * @vitest-environment node
 * The spend record's daily key read, stated once and run against every backend
 * the package can reach without a store. The ClickHouse tier is covered by
 * gateway-spend-daily-key-spend.integration.test.ts with the same seed.
 */
import { describe, expect, it } from "vitest";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import type { GatewaySpendEventsRepository } from "../gateway-spend-events.repository.ts";
import { MemoryGatewaySpendEventsRepository } from "../memory/memory.gateway-spend-events.repository.ts";

const backends: readonly { name: string; create: () => GatewaySpendEventsRepository }[] = [
  { name: "memory", create: () => MemoryGatewaySpendEventsRepository.create() },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const NANO_PER_USD = 1_000_000_000;
const day = Date.UTC(2026, 10, 20);
const since = day - 7 * DAY_MS;
const until = day + DAY_MS;

function state({
  status,
  virtualKeyId = "vk-a",
  providerKey = "prov-1",
  occurredAtMs = day + 3_600_000,
  updatedAt = occurredAtMs,
  costNanoUsd = 0,
}: {
  status: GatewaySpendState["status"];
  virtualKeyId?: string;
  providerKey?: string;
  occurredAtMs?: number;
  updatedAt?: number;
  costNanoUsd?: number;
}): GatewaySpendState {
  return {
    status,
    organizationId: "org-1",
    virtualKeyId,
    principalUserId: "user-1",
    endUserId: "",
    model: "openai/gpt-5-mini",
    providerKey,
    traceId: "trace-1",
    requestType: "chat",
    labels: [],
    metadataJson: "{}",
    podId: "pod-1",
    podSeq: 1,
    usage: null,
    rateVersion: "catalog@test",
    costNanoUsd,
    errorType: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs,
    durationMs: 0,
    createdAt: occurredAtMs,
    updatedAt,
    LastEventOccurredAt: occurredAtMs,
  };
}

describe.each(backends)("given the $name gateway spend events repository", ({ create }) => {
  const fold = (
    repository: GatewaySpendEventsRepository,
    {
      tenantId = "project-1",
      requestId,
      at,
    }: { tenantId?: string; requestId: string; at: GatewaySpendState },
  ) => repository.upsertFromFold([{ tenantId, gatewayRequestId: requestId, state: at }]);
  const daily = (repository: GatewaySpendEventsRepository, projectIds = ["project-1"]) =>
    repository.findDailyKeySpend({ projectIds, since, until });
  const byKey = (rows: Awaited<ReturnType<typeof daily>>) =>
    rows.toSorted(
      (a, b) =>
        a.projectId.localeCompare(b.projectId) ||
        a.day - b.day ||
        a.virtualKeyId.localeCompare(b.virtualKeyId) ||
        a.providerId.localeCompare(b.providerId),
    );
  const at = day + 3_600_000;

  describe("when spend is read per day, virtual key and provider", () => {
    it("counts each request once at its latest version, the failed one as failed", async () => {
      const repository = create();
      await fold(repository, {
        requestId: "req-a",
        at: state({ status: "admitted", updatedAt: at, costNanoUsd: NANO_PER_USD }),
      });
      await fold(repository, {
        requestId: "req-a",
        at: state({ status: "failed", updatedAt: at + 1_000, costNanoUsd: 0 }),
      });
      await fold(repository, {
        requestId: "req-b",
        at: state({
          status: "confirmed",
          virtualKeyId: "vk-b",
          updatedAt: at,
          costNanoUsd: 2 * NANO_PER_USD,
        }),
      });

      expect(byKey(await daily(repository))).toEqual([
        {
          projectId: "project-1",
          day,
          virtualKeyId: "vk-a",
          providerId: "prov-1",
          requests: 1,
          failedRequests: 1,
          spendUsd: 0,
        },
        {
          projectId: "project-1",
          day,
          virtualKeyId: "vk-b",
          providerId: "prov-1",
          requests: 1,
          failedRequests: 0,
          spendUsd: 2,
        },
      ]);
    });

    it("keeps the newer version when an older one arrives after it", async () => {
      const repository = create();
      await fold(repository, {
        requestId: "req-a",
        at: state({ status: "confirmed", updatedAt: at + 1_000, costNanoUsd: 3 * NANO_PER_USD }),
      });
      await fold(repository, {
        requestId: "req-a",
        at: state({ status: "admitted", updatedAt: at, costNanoUsd: NANO_PER_USD }),
      });

      await expect(daily(repository)).resolves.toEqual([
        {
          projectId: "project-1",
          day,
          virtualKeyId: "vk-a",
          providerId: "prov-1",
          requests: 1,
          failedRequests: 0,
          spendUsd: 3,
        },
      ]);
    });

    it("counts admitted and settled requests and sums every status's cost", async () => {
      const repository = create();
      await fold(repository, { requestId: "r1", at: state({ status: "" }) });
      await fold(repository, {
        requestId: "r2",
        at: state({ status: "settled", costNanoUsd: NANO_PER_USD / 2 }),
      });
      await fold(repository, {
        requestId: "r3",
        at: state({ status: "confirmed", costNanoUsd: NANO_PER_USD }),
      });
      await fold(repository, {
        requestId: "r4",
        at: state({ status: "failed", costNanoUsd: NANO_PER_USD / 4 }),
      });

      await expect(daily(repository)).resolves.toEqual([
        {
          projectId: "project-1",
          day,
          virtualKeyId: "vk-a",
          providerId: "prov-1",
          requests: 4,
          failedRequests: 1,
          spendUsd: 1.75,
        },
      ]);
    });

    it("splits by UTC day, virtual key and provider", async () => {
      const repository = create();
      await fold(repository, {
        requestId: "r1",
        at: state({ status: "confirmed", occurredAtMs: day }),
      });
      await fold(repository, {
        requestId: "r2",
        at: state({ status: "confirmed", occurredAtMs: day - 1 }),
      });
      await fold(repository, {
        requestId: "r3",
        at: state({ status: "confirmed", occurredAtMs: day + 1, providerKey: "prov-2" }),
      });
      await fold(repository, {
        requestId: "r4",
        at: state({ status: "confirmed", occurredAtMs: day + DAY_MS - 1, providerKey: "" }),
      });

      const row = (overrides: { day: number; providerId: string }) => ({
        projectId: "project-1",
        virtualKeyId: "vk-a",
        requests: 1,
        failedRequests: 0,
        spendUsd: 0,
        ...overrides,
      });
      expect(byKey(await daily(repository))).toEqual([
        row({ day: day - DAY_MS, providerId: "prov-1" }),
        row({ day, providerId: "" }),
        row({ day, providerId: "prov-1" }),
        row({ day, providerId: "prov-2" }),
      ]);
    });

    it("counts a request at since and leaves one at until out", async () => {
      const repository = create();
      await fold(repository, {
        requestId: "at-since",
        at: state({ status: "confirmed", occurredAtMs: since }),
      });
      await fold(repository, {
        requestId: "at-until",
        at: state({ status: "confirmed", occurredAtMs: until }),
      });

      await expect(daily(repository)).resolves.toEqual([
        {
          projectId: "project-1",
          day: since,
          virtualKeyId: "vk-a",
          providerId: "prov-1",
          requests: 1,
          failedRequests: 0,
          spendUsd: 0,
        },
      ]);
    });

    it("keeps each asked project apart and leaves an unasked project out", async () => {
      const repository = create();
      for (const tenantId of ["project-1", "project-2", "project-3"]) {
        await fold(repository, {
          tenantId,
          requestId: "req-1",
          at: state({ status: "confirmed" }),
        });
      }

      const rows = await daily(repository, ["project-1", "project-2", "project-1"]);

      expect(byKey(rows).map((row) => [row.projectId, row.requests])).toEqual([
        ["project-1", 1],
        ["project-2", 1],
      ]);
    });

    it("answers no rows when the window holds no request", async () => {
      await expect(daily(create())).resolves.toEqual([]);
    });
  });
});
