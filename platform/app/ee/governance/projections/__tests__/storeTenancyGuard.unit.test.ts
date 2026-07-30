// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The three governance append stores take the tenant from the RECORD their
 * map produced and compare it against the batch context the runtime
 * resolved — the sole thing between one tenant's spend, KPIs and audit events
 * and another tenant's tables.
 */

import { describe, expect, it, vi } from "vitest";
import { createGatewayBudgetDebitsStore } from "../gatewayBudgetDebits.store";
import { createGovernanceKpisStore } from "../governanceKpis.store";
import { createGovernanceOcsfEventsStore } from "../governanceOcsfEvents.store";

const TENANT_A = "project-a";
const TENANT_B = "project-b";

function kpiRecord(tenantId: string) {
  return { tenantId, sourceId: "vk_1", traceId: "trace_1" } as never;
}
function ocsfRecord(tenantId: string) {
  return { tenantId, eventId: "evt_1" } as never;
}
function debitRecord(tenantId: string) {
  return { tenantId, virtualKeyId: "vk_1", gatewayRequestId: "req_1" } as never;
}

describe("GovernanceKpisAppendStore", () => {
  it("refuses to write when one row's tenant is not the batch context's", async () => {
    const repository = {
      insertContribution: vi.fn(),
      insertContributions: vi.fn(),
    };
    const store = createGovernanceKpisStore(repository as never);

    await expect(
      store.writeBatch([kpiRecord(TENANT_A), kpiRecord(TENANT_B)], {
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(/does not match/);
    expect(repository.insertContributions).not.toHaveBeenCalled();
  });

  it("writes records that match the batch context", async () => {
    const repository = {
      insertContribution: vi.fn(),
      insertContributions: vi.fn(),
    };
    const store = createGovernanceKpisStore(repository as never);

    await store.writeBatch([kpiRecord(TENANT_A)], { tenantId: TENANT_A });

    expect(repository.insertContributions).toHaveBeenCalledTimes(1);
  });
});

describe("GatewayBudgetDebitsAppendStore", () => {
  function makeStore() {
    const debits = {
      resolve: vi.fn(),
      resolveMany: vi.fn().mockResolvedValue([]),
    };
    const budgetCHRepository = { insertDebit: vi.fn(), insertDebits: vi.fn() };
    const store = createGatewayBudgetDebitsStore({
      debits,
      budgetCHRepository,
      changeEvents: { append: vi.fn() },
    } as never);
    return { store, debits, budgetCHRepository };
  }

  it("refuses to resolve or debit any budget when one row is foreign", async () => {
    const { store, debits } = makeStore();

    await expect(
      store.writeBatch([debitRecord(TENANT_A), debitRecord(TENANT_B)], {
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(/does not match/);
    expect(debits.resolveMany).not.toHaveBeenCalled();
  });
});

describe("GovernanceOcsfEventsAppendStore", () => {
  it("refuses to write the whole batch when one row is foreign", async () => {
    const repository = { insertEvent: vi.fn(), insertEvents: vi.fn() };
    const store = createGovernanceOcsfEventsStore(repository as never);

    await expect(
      store.writeBatch([ocsfRecord(TENANT_A), ocsfRecord(TENANT_B)], {
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(/does not match/);
    expect(repository.insertEvents).not.toHaveBeenCalled();
  });

  it("writes records that match the batch context", async () => {
    const repository = { insertEvent: vi.fn(), insertEvents: vi.fn() };
    const store = createGovernanceOcsfEventsStore(repository as never);

    await store.writeBatch([ocsfRecord(TENANT_A)], { tenantId: TENANT_A });

    expect(repository.insertEvents).toHaveBeenCalledTimes(1);
  });
});
