/**
 * The Scenario Connector agent's config as the agent module reads it (ADR-194).
 * @vitest-environment node
 * @see modules/agent/specs/scenario-connector-agent.feature
 */
import { describe, expect, it } from "vitest";

import {
  CONNECTOR_BLOCK_MAX_BYTES,
  connectorAgentConfigSchema,
  parseAgentConfig,
} from "../config/index.ts";

const block = (code = "def execute(input):\n    return {'reply': 'hi'}\n") => ({
  language: "python",
  code,
});

const full = {
  call: block(),
  setup: block("def execute(input):\n    return {'state': {'accountId': 'acc_1'}}\n"),
  teardown: block("def execute(input):\n    return {'deleted': 1}\n"),
  secretNames: ["SHOP_ADMIN_KEY", "SHOP_BASE_URL"],
  fixturesDatasetId: "dataset_1",
  timeoutMs: 30_000,
};

describe("connectorAgentConfigSchema", () => {
  describe("given a config with every field", () => {
    /** @scenario "A connector config keeps every field it is saved with" */
    it("keeps every field when parsed for the connector type", () => {
      expect(parseAgentConfig("connector", full)).toEqual(full);
    });
  });

  describe("given a config with only a call block", () => {
    it("defaults the secret names to none", () => {
      expect(connectorAgentConfigSchema.parse({ call: block() })).toEqual({
        call: block(),
        secretNames: [],
      });
    });
  });

  describe("given a config without a call block", () => {
    /** @scenario "A connector agent needs a call block" */
    it("is refused", () => {
      expect(connectorAgentConfigSchema.validate({ setup: block() })).toBe(false);
    });
  });

  describe("given a block that breaks the block rules", () => {
    /** @scenario "A connector block is Python and at most 64 KiB" */
    it.each([
      ["in another language", { language: "javascript", code: "return 1" }],
      ["with no code", { language: "python", code: "" }],
      ["with code over 64 KiB", block("#".repeat(CONNECTOR_BLOCK_MAX_BYTES + 1))],
    ])("refuses a block %s", (_case, call) => {
      expect(connectorAgentConfigSchema.validate({ call })).toBe(false);
    });

    it("accepts code of exactly 64 KiB", () => {
      const call = block("#".repeat(CONNECTOR_BLOCK_MAX_BYTES));
      expect(connectorAgentConfigSchema.validate({ call })).toBe(true);
    });
  });

  describe("given a secret name that is not a project secret name", () => {
    /** @scenario "A connector names its secrets by their project secret names" */
    it.each(["shop_key", "1KEY", "SHOP-KEY", ""])("refuses %j", (name) => {
      expect(connectorAgentConfigSchema.validate({ call: block(), secretNames: [name] })).toBe(
        false,
      );
    });
  });
});
