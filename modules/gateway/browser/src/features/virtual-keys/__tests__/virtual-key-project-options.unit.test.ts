/**
 * A virtual key's destination picker never offers a project that receives no traces (ADR-177).
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import { virtualKeyProjectOptions } from "../model/virtual-key-project-options.ts";

describe("virtualKeyProjectOptions", () => {
  describe("given a team holding an ordinary, an aggregate and the governance project", () => {
    /** @scenario "The aggregate project is absent from every send-traces-here picker" */
    it("offers only the ordinary project", () => {
      const options = virtualKeyProjectOptions([
        {
          id: "team-1",
          name: "ACME",
          projects: [
            { id: "p-app", name: "Support bot", kind: "application" },
            { id: "p-agg", name: "Company view", kind: "aggregate" },
            { id: "p-gov", name: "Governance", kind: "internal_governance" },
          ],
        },
      ]);

      expect(options).toEqual([{ id: "p-app", name: "Support bot", teamId: "team-1" }]);
    });
  });
});
