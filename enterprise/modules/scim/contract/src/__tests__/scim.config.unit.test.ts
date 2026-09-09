import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { scimServerConfigDefinition } from "../scim.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "scim", definition: scimServerConfigDefinition, source }).value;

describe("scim server configuration", () => {
  describe("given a deployment wires no directory", () => {
    /** @scenario "A feature's defaults are the values a deployment already runs on" */
    it("keeps the proven offboarding path off and the webhook unrouted", () => {
      expect(read({})).toEqual({ auth0WebhookSecret: undefined, provenOffboarding: false });
    });
  });

  describe("given the proven offboarding path is selected", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("selects it once, at boot", () => {
      expect(read({ SCIM_V2_GRANTS: "true" }).provenOffboarding).toBe(true);
    });
  });
});
