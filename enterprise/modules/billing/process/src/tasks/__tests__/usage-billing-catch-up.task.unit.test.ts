// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage-billing catch-up stops at the first organization it cannot record (ADR-174
 * decision 17): the run fails loudly and is re-run, rather than reporting a partial catch-up.
 */
import { describe, expect, it } from "vitest";

import { UsageBillingCatchUpTask } from "../usage-billing-catch-up.task.ts";

describe("UsageBillingCatchUpTask", () => {
  describe("given recording fails for the second of three organizations", () => {
    it("throws, and never records the third", async () => {
      const attempted: string[] = [];
      const task = UsageBillingCatchUpTask.create({
        organizations: {
          listIds: async () => ({ ids: ["org-1", "org-2", "org-3"], next: null }),
        },
        billing: {
          catchUpUsageBilling: async ({ organizationId }) => {
            attempted.push(organizationId);
            if (organizationId === "org-2") throw new Error("billing is unavailable");
            return { usageBilled: false };
          },
        },
      });

      await expect(task.run({ args: [], signal: new AbortController().signal })).rejects.toThrow(
        "billing is unavailable",
      );
      expect(attempted).toEqual(["org-1", "org-2"]);
    });
  });
});
