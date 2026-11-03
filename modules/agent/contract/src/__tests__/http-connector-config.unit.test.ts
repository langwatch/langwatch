/**
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { describe, expect, it } from "vitest";

import { CONNECTOR_CODE_MAX_BYTES } from "../config/connector.ts";
import { httpAgentConfigSchema } from "../config/http.ts";

const url = "https://shop.example.com/chat";
const setup = {
  language: "python",
  code: "def execute(input):\n    return {'state': {'accountId': 'acc_1'}}\n",
  secretNames: ["SHOP_ADMIN_KEY"],
  datasetId: "dataset_personas",
};

describe("the Connector on an HTTP agent config", () => {
  describe("given a setup and a teardown step", () => {
    it("keeps both steps on parse", () => {
      const connector = { setup, teardown: { ...setup, datasetId: undefined } };

      const parsed = httpAgentConfigSchema.parse({ url, connector });

      expect(parsed.connector?.setup).toEqual(setup);
      expect(parsed.connector?.teardown?.code).toBe(setup.code);
    });
  });

  describe("given a step with no secret names", () => {
    it("reads as naming none", () => {
      const parsed = httpAgentConfigSchema.parse({
        url,
        connector: { setup: { language: "python", code: "x = 1" } },
      });

      expect(parsed.connector?.setup?.secretNames).toEqual([]);
    });
  });

  describe("given an agent without a Connector", () => {
    it("parses as today", () => {
      expect(httpAgentConfigSchema.parse({ url })).not.toHaveProperty("connector");
    });
  });

  describe("given a step the code runner cannot run", () => {
    /** @scenario "The Connector config is checked when it is read" */
    it.each([
      ["a language it does not offer", { ...setup, language: "ruby" }],
      ["code over 64 KiB", { ...setup, code: "#".repeat(CONNECTOR_CODE_MAX_BYTES + 1) }],
      ["no code", { ...setup, code: "" }],
      ["a secret name that is not an identifier", { ...setup, secretNames: ["NOT-A-NAME"] }],
      ["a secret name a stored secret cannot have", { ...setup, secretNames: ["shop_key"] }],
    ])("refuses %s", (_case, step) => {
      expect(httpAgentConfigSchema.validate({ url, connector: { setup: step } })).toBe(false);
    });
  });
});
