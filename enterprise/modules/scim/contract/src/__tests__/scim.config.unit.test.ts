import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { scimConfig } from "../scim.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "scim", config: scimConfig }], environment }).scim;

describe("scim server configuration", () => {
  describe("given a deployment wires no directory", () => {
    /** @scenario "A feature's defaults are the values a deployment already runs on" */
    it("runs the proven offboarding path by default", () => {
      expect(read({})).toEqual({ provenOffboarding: true });
    });
  });

  describe("given the proven offboarding path is selected", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("selects it once, at boot", () => {
      expect(read({ SCIM_V2_GRANTS: "true" }).provenOffboarding).toBe(true);
    });
  });
});
