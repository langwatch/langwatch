import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { modelProviderServerConfigDefinition } from "../model-provider.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({
    name: "model-provider",
    definition: modelProviderServerConfigDefinition,
    source,
  }).value;

describe("model provider server configuration", () => {
  describe("given the deployment sets no allowlist", () => {
    /** @scenario "An absent allowlist resolves to an empty one, never a wildcard" */
    it("resolves an empty allowlist rather than a wildcard", () => {
      expect(read({}).allowedProxyHosts).toEqual([]);
    });
  });

  describe("given the allowlist carries blanks and spacing", () => {
    /** @scenario "An absent allowlist resolves to an empty one, never a wildcard" */
    it("drops the blanks so no empty host sits in the list", () => {
      expect(read({ ALLOWED_PROXY_HOSTS: " a.test , ,b.test " }).allowedProxyHosts).toEqual([
        "a.test",
        "b.test",
      ]);
    });
  });

  describe("given the local-address fence carries the deployment's spelling", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads 1 and true as on and everything else as off", () => {
      expect(read({ BLOCK_LOCAL_HTTP_CALLS: "true" }).blockLocalHttpCalls).toBe(true);
      expect(read({ BLOCK_LOCAL_HTTP_CALLS: "yes" }).blockLocalHttpCalls).toBe(false);
    });
  });

  describe("given a blank engine address or model", () => {
    /** @scenario "A blank identifier resolves to absent rather than to an empty filter" */
    it("resolves both to absent so nothing composes an empty address", () => {
      expect(read({ LANGWATCH_NLP_SERVICE: "  ", LANGWATCH_DEFAULT_MODEL: "" })).toMatchObject({
        nlpServiceUrl: undefined,
        defaultModel: undefined,
      });
    });
  });
});
