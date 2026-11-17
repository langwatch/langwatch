// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationCreatedEventData } from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  NurturingOrganizationCreatedService,
  ORGANIZATION_CREATED_STALE_AFTER_MS,
} from "../nurturing-organization-created.service.ts";

const CREATED_AT = Date.UTC(2026, 10, 17, 9, 0, 0, 750);
const PINO_KEYS = new Set(["level", "time", "pid", "hostname", "msg"]);

/** The service over a recording Customer.io batch and its own test logger, its clock at `nowMs`. */
function serviceOver({ nowMs = CREATED_AT }: { nowMs?: number } = {}) {
  const sent: CioBatchCall[][] = [];
  const { logger, lines } = createTestLogger();
  const service = NurturingOrganizationCreatedService.create({
    sendBatch: async (calls) => void sent.push(calls),
    logger,
    now: () => Temporal.Instant.fromEpochMilliseconds(nowMs),
  });
  return { service, sent, lines };
}

const created = (userId: string | undefined): OrganizationCreatedEventData => ({
  tenantId: "org-1",
  organizationId: "org-1",
  organizationName: "Acme",
  ...(userId === undefined ? {} : { userId }),
  occurredAt: CREATED_AT,
});

describe("NurturingOrganizationCreatedService", () => {
  describe("when organization records a creation naming a founder and no sign-up", () => {
    /** @scenario "An organization created for an existing user gets its name and plan" */
    it("sends the founder one group call with the name, plan free and created_at", async () => {
      const { service, sent } = serviceOver();

      await service.organizationCreated(created("founder-1"));

      expect(sent).toEqual([
        [
          {
            type: "group",
            userId: "founder-1",
            groupId: "org-1",
            traits: { name: "Acme", plan: "free", created_at: Math.floor(CREATED_AT / 1000) },
          },
        ],
      ]);
      expect(sent.flat().some((call) => call.type === "track")).toBe(false);
    });
  });

  describe("when organization records a creation naming no founder", () => {
    /** @scenario "A provisioned organization with no founder sends nothing" */
    it("sends nothing and logs one line with a count and no ids", async () => {
      const { service, sent, lines } = serviceOver();

      await service.organizationCreated(created(undefined));

      expect(sent).toEqual([]);
      expect(lines).toHaveLength(1);
      const [line] = lines;
      const payload = Object.fromEntries(
        Object.entries(line ?? {}).filter(([key]) => !PINO_KEYS.has(key)),
      );
      expect(payload).toEqual({ organizations: 1, reason: "no_founder" });
      expect(JSON.stringify(line)).not.toContain("org-1");
    });
  });

  describe("when a creation fact is replayed long after it happened", () => {
    it("a replayed organization-created fact older than a day sends nothing", async () => {
      const nowMs = CREATED_AT + ORGANIZATION_CREATED_STALE_AFTER_MS + 1;
      const { service, sent, lines } = serviceOver({ nowMs });

      await service.organizationCreated(created("founder-1"));

      expect(sent).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ organizations: 1, reason: "stale" });
      expect(JSON.stringify(lines[0])).not.toMatch(/org-1|founder-1/);
    });

    it("still sends a fact exactly a day old", async () => {
      const { service, sent } = serviceOver({
        nowMs: CREATED_AT + ORGANIZATION_CREATED_STALE_AFTER_MS,
      });

      await service.organizationCreated(created("founder-1"));

      expect(sent).toHaveLength(1);
    });
  });
});
