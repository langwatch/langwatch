/** The eval-function gate counts an organization's own Instant Evals switch, not only the flag. */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { instantEvalsEnabled } from "../lwql-access.rules.ts";

const PROJECT_ID = "project-acme";

function gate({
  flag,
  organizationId,
  optedIn,
}: {
  flag: boolean;
  organizationId: string;
  optedIn: boolean;
}) {
  const optInReads: string[] = [];
  const answer = instantEvalsEnabled({
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: () => Promise.resolve(flag) }),
    projectId: PROJECT_ID,
    projects: createApiFixture<ProjectApi>({
      getOrganizationId: () => Promise.resolve(organizationId),
    }),
    organizations: createApiFixture<OrganizationApi>({
      isInstantEvalsOptedIn: (input) => {
        optInReads.push(input.organizationId);

        return Promise.resolve(optedIn);
      },
    }),
  });

  return { answer, optInReads };
}

describe("instantEvalsEnabled()", () => {
  describe("given the flag is off and the organization switched Instant Evals on", () => {
    it("opens the eval functions", async () => {
      const { answer, optInReads } = gate({
        flag: false,
        organizationId: "org-acme",
        optedIn: true,
      });

      await expect(answer).resolves.toBe(true);
      expect(optInReads).toEqual(["org-acme"]);
    });
  });

  describe("given the flag is off and the organization never switched them on", () => {
    it("keeps the eval functions closed", async () => {
      const { answer } = gate({ flag: false, organizationId: "org-acme", optedIn: false });

      await expect(answer).resolves.toBe(false);
    });
  });

  describe("given the flag is on", () => {
    it("opens them without reading the organization's switch", async () => {
      const { answer, optInReads } = gate({
        flag: true,
        organizationId: "org-acme",
        optedIn: false,
      });

      await expect(answer).resolves.toBe(true);
      expect(optInReads).toEqual([]);
    });
  });

  describe("given the flag is off and the project names no organization", () => {
    it("fails closed without reading a switch", async () => {
      const { answer, optInReads } = gate({ flag: false, organizationId: "", optedIn: true });

      await expect(answer).resolves.toBe(false);
      expect(optInReads).toEqual([]);
    });
  });
});
