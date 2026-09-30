import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { processOwner } from "../owner.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [processOwner], environment }).process;

describe("the process owner's own declaration", () => {
  describe("given a deployment states its public origin", () => {
    it("reads it, and treats blank as having named none", () => {
      expect(read({ BASE_HOST: "https://app.langwatch.test" }).baseHost).toBe(
        "https://app.langwatch.test",
      );
      expect(read({ BASE_HOST: "   " }).baseHost).toBeUndefined();
      expect(read({}).baseHost).toBeUndefined();
    });
  });

  describe("given the deployment flag", () => {
    it("recognizes both spellings without enabling an absent flag", () => {
      expect(read({ IS_SAAS: "1" }).isSaas).toBe(true);
      expect(read({ IS_SAAS: "true" }).isSaas).toBe(true);
      expect(read({ IS_SAAS: "false" }).isSaas).toBe(false);
      expect(read({}).isSaas).toBe(false);
    });
  });

  describe("given an environment name", () => {
    it("carries it raw, so a reader decides what counts as production", () => {
      expect(read({ NODE_ENV: "production" }).nodeEnvironment).toBe("production");
      expect(read({}).nodeEnvironment).toBeUndefined();
    });
  });

  describe("given a deployment sets the standard proxy variables", () => {
    it("reads each spelling once, for every module's outbound calls to follow", () => {
      const { outboundProxy } = read({ https_proxy: "http://proxy.corp:8080", NO_PROXY: ".corp" });

      expect(outboundProxy.https_proxy).toBe("http://proxy.corp:8080");
      expect(outboundProxy.NO_PROXY).toBe(".corp");
    });
  });
});
