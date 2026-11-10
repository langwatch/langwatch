// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { emptyProjectUsage, foldProjectUsage } from "../../rules/nurturing-project-usage.rules.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const NOW = Date.UTC(2026, 10, 20, 12);

async function serviceOver({ placed }: { placed: ReadonlyMap<string, string> }) {
  const projectUsage = MemoryNurturingProjectUsageRepository.create();
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  const sent: CioBatchCall[][] = [];
  const service = NurturingOrganizationUsageService.create({
    projectUsage,
    projects: MemoryNurturingProjectDirectoryRepository.create({ placed }),
    milestones,
    sendBatch: async (calls) => void sent.push(calls),
    clock: { nowMs: () => NOW },
  });
  return { service, projectUsage, sent };
}

const usageOf = (projectId: string, promptIds: readonly string[]) =>
  promptIds.reduce(
    (state, promptId) =>
      foldProjectUsage(state, { kind: "prompt_created", promptId, occurredAt: NOW }),
    emptyProjectUsage(projectId),
  );

describe("NurturingOrganizationUsageService", () => {
  /** @scenario "A changed project sends its organization's traits as one group call on the admin" */
  it("sends one group call on the admin with the organization's summed traits", async () => {
    const { service, projectUsage, sent } = await serviceOver({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-2", "org-1"],
      ]),
    });
    const first = usageOf("project-1", ["p1", "p2"]);
    const second = usageOf("project-2", ["p3"]);
    await projectUsage
      .forOwner("prompt")
      .store(second, { aggregateId: "project-2", tenantId: "project-2" } as never);
    await service.usageChanged(second);
    await projectUsage
      .forOwner("prompt")
      .store(first, { aggregateId: "project-1", tenantId: "project-1" } as never);
    sent.length = 0;

    await service.usageChanged(first);

    expect(sent).toEqual([
      [
        {
          type: "group",
          userId: "admin-1",
          groupId: "org-1",
          traits: expect.objectContaining({ prompt_count: 3, trace_count: 0 }),
        },
      ],
    ]);
  });

  /** @scenario "Each owner's fold keeps its own row, and the organization sums every row" */
  it("sums one project's rows from two owners' folds", async () => {
    const { service, projectUsage, sent } = await serviceOver({
      placed: new Map([["project-1", "org-1"]]),
    });
    const prompts = usageOf("project-1", ["p1"]);
    const traces = foldProjectUsage(emptyProjectUsage("project-1"), {
      kind: "trace_received",
      traceId: "t1",
      containsErrorStatus: true,
      totalCost: 0.5,
      occurredAt: NOW,
    });
    const context = { aggregateId: "project-1", tenantId: "project-1" } as never;
    await projectUsage.forOwner("prompt").store(prompts, context);
    await projectUsage.forOwner("trace").store(traces, context);

    await service.usageChanged(traces);

    expect(sent[0]?.[0]).toMatchObject({
      traits: { prompt_count: 1, trace_count: 1, error_count: 1, total_cost: 0.5 },
    });
  });

  /** @scenario "A project placed in no organization sends nothing" */
  it("sends nothing for a project placed in no organization", async () => {
    const { service, projectUsage, sent } = await serviceOver({ placed: new Map() });
    const usage = usageOf("project-9", ["p1"]);
    await projectUsage
      .forOwner("prompt")
      .store(usage, { aggregateId: "project-9", tenantId: "project-9" } as never);

    await service.usageChanged(usage);

    expect(sent).toEqual([]);
  });
});
