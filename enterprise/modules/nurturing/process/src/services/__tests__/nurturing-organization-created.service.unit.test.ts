// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationCreatedEventData } from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { NurturingOrganizationCreatedService } from "../nurturing-organization-created.service.ts";

const CREATED_AT = Date.UTC(2026, 10, 17, 9, 0, 0, 750);
const PINO_KEYS = new Set(["level", "time", "pid", "hostname", "msg"]);

/** The service over a recording Customer.io batch and its own test logger. */
function serviceOver() {
  const sent: CioBatchCall[][] = [];
  const { logger, lines } = createTestLogger();
  const service = NurturingOrganizationCreatedService.create({
    sendBatch: async (calls) => void sent.push(calls),
    logger,
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
    /** @scenario "An organization created for an existing user gets its name and creation time" */
    it("sends the founder one group call with the name and created_at, and no plan", async () => {
      const { service, sent } = serviceOver();

      await service.organizationCreated(created("founder-1"));

      expect(sent).toEqual([
        [
          {
            type: "group",
            userId: "founder-1",
            groupId: "org-1",
            traits: { name: "Acme", created_at: Math.floor(CREATED_AT / 1000) },
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
});
