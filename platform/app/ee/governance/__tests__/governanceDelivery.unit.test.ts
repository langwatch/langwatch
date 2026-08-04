// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import { runDeliverGovernance } from "../process-manager/governanceEventsDelivery.process";

function harness(endpoints: Array<{ id: string; enabledEvents: string[] }>) {
  const commits: unknown[] = [];
  const deps = {
    prisma: {} as never,
    processStore: {
      findByRef: vi.fn().mockResolvedValue(null),
      commit: vi.fn().mockImplementation((input: { messages: unknown[] }) => {
        commits.push(input);
        return Promise.resolve({ outcome: "committed" });
      }),
    },
    endpoints: {
      getActiveByOrganization: vi
        .fn()
        .mockResolvedValue(endpoints.map((e) => ({ ...e, status: "ACTIVE" }))),
    },
    getPlan: vi.fn().mockResolvedValue({ webhookEndpointsEnabled: true }),
    now: () => 1_753_800_000_000,
  } as never;
  return { deps, commits };
}

const envelope = {
  id: "vk_1:disabled:1753800000000",
  type: "gateway.virtual_key.disabled",
  created: "2026-07-29T15:20:00.000Z",
  schema_version: "1" as const,
  data: { event_type: "gateway.virtual_key.disabled" },
};

describe("governance delivery fan-out", () => {
  /** @scenario Governance events only reach endpoints subscribed to their types */
  it("delivers to lifecycle and family subscriptions, never spend-only ones", async () => {
    const { deps, commits } = harness([
      { id: "ep_spend", enabledEvents: ["gateway.request.completed"] },
      { id: "ep_lifecycle", enabledEvents: ["gateway.virtual_key.disabled"] },
      { id: "ep_family", enabledEvents: ["gateway.*"] },
    ]);
    await runDeliverGovernance(deps)(
      {
        organization_id: "org_1",
        project_id: "proj_1",
        event_type: envelope.type,
        envelope,
      },
      { attempt: 1 } as never,
    );
    const keys = commits.map(
      (c) => (c as { ref: { processKey: string } }).ref.processKey,
    );
    expect(keys).toEqual(["endpoint:ep_lifecycle", "endpoint:ep_family"]);
  });
});
