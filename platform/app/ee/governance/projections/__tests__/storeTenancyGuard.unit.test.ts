// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The three governance append stores take the tenant from the RECORD their
 * map projection produced and ignore the store context the router resolved.
 * That is correct only for as long as every `map()` sets
 * `tenantId: event.tenantId` — which makes the map implementation the sole
 * thing between one tenant's spend, KPIs and audit events and another
 * tenant's tables.
 *
 * These tests pin the guard that closes that: the two answers are compared at
 * the write, and a mismatch fails loudly instead of routing silently.
 */

import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing.old/domain/tenantId";
import { GatewayBudgetDebitsAppendStore } from "../gatewayBudgetDebits.store";
import { GovernanceKpisAppendStore } from "../governanceKpis.store";
import { GovernanceOcsfEventsAppendStore } from "../governanceOcsfEvents.store";

const TENANT_A = createTenantId("project-a");
const TENANT_B = createTenantId("project-b");

function kpiRecord(tenantId: string) {
  return {
    tenantId,
    sourceId: "vk_1",
    traceId: "trace_1",
  } as never;
}

function ocsfRecord(tenantId: string) {
  return { tenantId, eventId: "evt_1" } as never;
}

function debitRecord(tenantId: string) {
  return {
    tenantId,
    virtualKeyId: "vk_1",
    gatewayRequestId: "req_1",
  } as never;
}

describe("GovernanceKpisAppendStore", () => {
  describe("given a record whose tenant is not the projection context's", () => {
    describe("when it is appended", () => {
      it("refuses to write", async () => {
        const repository = {
          insertContribution: vi.fn(),
          insertContributions: vi.fn(),
        };
        const store = new GovernanceKpisAppendStore(repository as never);

        await expect(
          store.append(kpiRecord(String(TENANT_B)), {
            aggregateId: "agg_1",
            tenantId: TENANT_A,
          }),
        ).rejects.toThrow(/\[SECURITY\]/);
        expect(repository.insertContribution).not.toHaveBeenCalled();
      });

      it("refuses to write the whole batch when one row is foreign", async () => {
        const repository = {
          insertContribution: vi.fn(),
          insertContributions: vi.fn(),
        };
        const store = new GovernanceKpisAppendStore(repository as never);

        await expect(
          store.bulkAppend(
            [kpiRecord(String(TENANT_A)), kpiRecord(String(TENANT_B))],
            { tenantId: TENANT_A },
          ),
        ).rejects.toThrow(/\[SECURITY\]/);
        expect(repository.insertContributions).not.toHaveBeenCalled();
      });
    });
  });

  describe("given records that match the projection context", () => {
    describe("when they are appended", () => {
      it("writes them", async () => {
        const repository = {
          insertContribution: vi.fn(),
          insertContributions: vi.fn(),
        };
        const store = new GovernanceKpisAppendStore(repository as never);

        await store.append(kpiRecord(String(TENANT_A)), {
          aggregateId: "agg_1",
          tenantId: TENANT_A,
        });
        await store.bulkAppend([kpiRecord(String(TENANT_A))], {
          tenantId: TENANT_A,
        });

        expect(repository.insertContribution).toHaveBeenCalledTimes(1);
        expect(repository.insertContributions).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe("GatewayBudgetDebitsAppendStore", () => {
  function makeStore() {
    const debits = { resolve: vi.fn(), resolveMany: vi.fn() };
    const budgetCHRepository = {
      insertDebit: vi.fn(),
      insertDebits: vi.fn(),
    };
    const store = new GatewayBudgetDebitsAppendStore({
      debits,
      budgetCHRepository,
      changeEvents: { append: vi.fn() },
    } as never);
    return { store, debits, budgetCHRepository };
  }

  describe("given a record whose tenant is not the projection context's", () => {
    describe("when it is appended", () => {
      it("refuses to resolve or debit any budget", async () => {
        const { store, debits, budgetCHRepository } = makeStore();

        await expect(
          store.append(debitRecord(String(TENANT_B)), {
            aggregateId: "agg_1",
            tenantId: TENANT_A,
          }),
        ).rejects.toThrow(/\[SECURITY\]/);
        expect(debits.resolve).not.toHaveBeenCalled();
        expect(budgetCHRepository.insertDebit).not.toHaveBeenCalled();
      });

      it("refuses the whole batch when one row is foreign", async () => {
        const { store, debits } = makeStore();

        await expect(
          store.bulkAppend(
            [debitRecord(String(TENANT_A)), debitRecord(String(TENANT_B))],
            { tenantId: TENANT_A },
          ),
        ).rejects.toThrow(/\[SECURITY\]/);
        expect(debits.resolveMany).not.toHaveBeenCalled();
      });
    });
  });
});

describe("GovernanceOcsfEventsAppendStore", () => {
  describe("given a record whose tenant is not the projection context's", () => {
    describe("when it is appended", () => {
      it("refuses to write the audit event", async () => {
        const repository = {
          insertEvent: vi.fn(),
          insertEvents: vi.fn(),
        };
        const store = new GovernanceOcsfEventsAppendStore(repository as never);

        await expect(
          store.append(ocsfRecord(String(TENANT_B)), {
            aggregateId: "agg_1",
            tenantId: TENANT_A,
          }),
        ).rejects.toThrow(/\[SECURITY\]/);
        expect(repository.insertEvent).not.toHaveBeenCalled();
      });

      it("refuses to write the whole batch when one row is foreign", async () => {
        const repository = {
          insertEvent: vi.fn(),
          insertEvents: vi.fn(),
        };
        const store = new GovernanceOcsfEventsAppendStore(repository as never);

        await expect(
          store.bulkAppend(
            [ocsfRecord(String(TENANT_A)), ocsfRecord(String(TENANT_B))],
            { tenantId: TENANT_A },
          ),
        ).rejects.toThrow(/\[SECURITY\]/);
        expect(repository.insertEvents).not.toHaveBeenCalled();
      });
    });
  });
});
