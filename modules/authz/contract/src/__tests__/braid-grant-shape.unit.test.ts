/**
 * ADR-183 §1: a braid is the shared span read, the second legal foreign placement.
 * @see modules/authz/specs/braids.feature
 */
import { BRAID_CONDITION_COMPILER_VERSION } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { grantAttachedPayloadSchema } from "../authz-grant.events.ts";

const COMPILED = {
  version: BRAID_CONDITION_COMPILER_VERSION,
  tree: { kind: "nameEquals", value: "payments_agent" },
};

function attach(overrides: Record<string, unknown>) {
  return grantAttachedPayloadSchema.safeParse({
    grantId: "grant_1",
    principal: { type: "project", id: "proj_orchestrator" },
    roleKey: "project-reader",
    scope: { type: "PROJECT", id: "proj_specialists" },
    source: "braid",
    actor: { type: "user", id: "user_ana" },
    condition: {
      type: "span",
      where: 'name == "payments_agent"',
      compiledWhere: COMPILED,
      from: "2026-10-01T00:00:00.000Z",
    },
    ...overrides,
  });
}

describe("the shared grant shape", () => {
  describe("when a braid's span condition carries a where", () => {
    /** @scenario "A span condition with a compiled where is a legal shared placement" */
    it("accepts it with its compiled form and refuses it without", () => {
      expect(attach({}).success).toBe(true);
      expect(
        attach({
          condition: { type: "span", where: 'name == "x"', from: "2026-10-01T00:00:00.000Z" },
        }).success,
      ).toBe(false);
    });

    it("still refuses a trace condition carrying a where", () => {
      const condition = {
        type: "trace",
        where: 'name == "x"',
        compiledWhere: COMPILED,
        from: "2026-10-01T00:00:00.000Z",
      };

      expect(attach({ condition }).success).toBe(false);
      expect(attach({ condition, source: "aggregate-reconciler" }).success).toBe(false);
    });
  });

  describe("when the source is not a braid", () => {
    it("refuses a where on the aggregate's shared read and keeps its empty-where read", () => {
      const read = {
        source: "aggregate-reconciler",
        condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" },
      };

      expect(attach(read).success).toBe(true);
      expect(attach({ source: "aggregate-reconciler" }).success).toBe(false);
    });
  });

  describe("when a braid is anything but the shared span read", () => {
    it("refuses a braid on the reader's own project or with a role other than project-reader", () => {
      expect(attach({ scope: { type: "PROJECT", id: "proj_orchestrator" } }).success).toBe(false);
      expect(attach({ roleKey: "admin" }).success).toBe(false);
      expect(
        attach({ condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" } }).success,
      ).toBe(false);
    });
  });
});
