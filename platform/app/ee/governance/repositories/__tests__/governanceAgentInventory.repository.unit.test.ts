// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What the organization-wide agents read asks for, held down against a fake
 * client.
 *
 * The whole risk in this repository is in the `where`, and every way it can go
 * wrong is silent. Drop the type filter and a governance inventory fills with
 * optimization studio nodes; drop the project filter and it lists the hidden
 * routing project; drop the presence rule and it shows agents this
 * organization's own project pages stopped showing a month ago. None of those
 * throws, and a reader cannot tell any of them from a correct answer.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { CONNECTED_AGENT_UNSEEN_DAYS } from "~/server/agents/connected-agent-visibility";

import { OrganizationConnectedAgentRepository } from "../governanceAgentInventory.repository";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

async function readWith(now: Date) {
  const findMany = vi.fn().mockResolvedValue([]);
  const client = { agent: { findMany } } as unknown as PrismaClient;

  await new OrganizationConnectedAgentRepository().listByOrganization(client, {
    organizationId: "org-1",
    now,
  });

  const args = findMany.mock.calls[0]?.[0] as {
    where: Record<string, any>;
    select: Record<string, boolean>;
  };
  return args;
}

describe("given the organization's own agents are read", () => {
  describe("when the read is issued", () => {
    /** @scenario "The organization's agents read leaves out what does not belong on it" */
    it("asks only for agents registered from code", async () => {
      const { where } = await readWith(NOW);

      expect(where.type).toBe("connected");
      expect(where.archivedAt).toBeNull();
    });

    /** @scenario "The organization's agents read leaves out what does not belong on it" */
    it("walks the organization's projects and skips the hidden one", async () => {
      const { where } = await readWith(NOW);

      expect(where.project).toEqual({
        archivedAt: null,
        kind: { not: "internal_governance" },
        team: { organizationId: "org-1" },
      });
    });

    /** @scenario "The organization's agents read leaves out what does not belong on it" */
    it("carries the presence rule, measured from the instant it was given", async () => {
      const { where } = await readWith(NOW);

      // The cutoff has to come from `now` rather than from the wall clock, or
      // this page and the project's own agents list disagree about which
      // agents are still present at the moment a request straddles.
      const expectedCutoff = new Date(
        NOW.getTime() - CONNECTED_AGENT_UNSEEN_DAYS * DAY_MS,
      );
      expect(where.AND).toEqual([
        {
          OR: [
            { type: { not: "connected" } },
            { lastSeenAt: null },
            { lastSeenAt: { gte: expectedCutoff } },
          ],
        },
      ]);
    });

    /** @scenario "The organization's agents read leaves out what does not belong on it" */
    it("selects every field the screen's mapper reads", async () => {
      const { select } = await readWith(NOW);

      expect(Object.keys(select).sort()).toEqual([
        "createdAt",
        "environment",
        "id",
        "lastSeenAt",
        "name",
        "ownerUserId",
      ]);
    });
  });
});
