import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { saasConfig } from "../saas.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "saas", config: saasConfig }], environment }).saas;

describe("saas server configuration", () => {
  describe("given the deployment flag carries the spelling every tier reads", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads 1 and true as the hosted product and everything else as self-hosted", () => {
      expect(read({ IS_SAAS: "1" }).isSaas).toBe(true);
      expect(read({ IS_SAAS: "TRUE" }).isSaas).toBe(true);
      expect(read({ IS_SAAS: "yes" }).isSaas).toBe(false);
      expect(read({}).isSaas).toBe(false);
    });
  });

  describe("given no operator list is named", () => {
    /** @scenario "A feature's defaults are the values a deployment already runs on" */
    it("leaves the list absent, which is nobody", () => {
      expect(read({}).adminEmails).toBeUndefined();
    });
  });
});
