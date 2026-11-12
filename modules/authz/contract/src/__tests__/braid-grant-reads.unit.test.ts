/**
 * ADR-185: a braid's attach is read one release before braids write it, so a worker still on
 * this build during a rolling upgrade folds the fact instead of refusing it.
 * @see specs/rbac/authz-grants.feature
 */
import { BRAID_CONDITION_COMPILER_VERSION } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { GRANT_EVENT_SOURCES, grantAttachedPayloadSchema } from "../authz-grant.events.ts";
import { attachGrantCommandDataSchema } from "../authz.commands.ts";

const ORG = "org_acme";
const COMPILED = {
  version: BRAID_CONDITION_COMPILER_VERSION,
  tree: { kind: "nameEquals", value: "payments_agent" },
};
const BRAID = {
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
  replacesGrantId: "grant_0",
};

function attach(overrides: Record<string, unknown> = {}) {
  return grantAttachedPayloadSchema.safeParse({ ...BRAID, ...overrides });
}

function command(overrides: Record<string, unknown> = {}) {
  return attachGrantCommandDataSchema.safeParse({
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_1",
    grant: { ...BRAID, occurredAtMs: 1_760_000_000_000, ...overrides },
  });
}

describe("a braid's attach on a build that does not write braids", () => {
  describe("when it carries a span condition with its compiled where and the braid it replaces", () => {
    /** @scenario "A braid's attach is read before braids are written" */
    it("parses as an event and as a command, keeping every braid field", () => {
      const event = attach();
      const sent = command();

      expect(event.success).toBe(true);
      expect(event.data).toMatchObject({
        source: "braid",
        condition: { type: "span", compiledWhere: COMPILED },
        replacesGrantId: "grant_0",
      });
      expect(sent.success).toBe(true);
      expect(sent.data?.grant).toMatchObject({
        source: "braid",
        condition: { compiledWhere: COMPILED },
        replacesGrantId: "grant_0",
      });
    });

    it("parses a braid with no condition text and nothing it replaces", () => {
      const condition = { type: "span", from: "2026-10-01T00:00:00.000Z" };

      expect(attach({ condition, replacesGrantId: undefined }).success).toBe(true);
      expect(command({ condition, replacesGrantId: undefined }).success).toBe(true);
    });

    it("refuses an empty id for the braid it replaces", () => {
      expect(attach({ replacesGrantId: "" }).success).toBe(false);
      expect(command({ replacesGrantId: "" }).success).toBe(false);
    });
  });

  describe("when a span condition's where comes without its compiled form", () => {
    /** @scenario "A braid's where is refused without its compiled form" */
    it("refuses the event and the command", () => {
      const condition = { type: "span", where: 'name == "x"', from: "2026-10-01T00:00:00.000Z" };

      expect(attach({ condition }).success).toBe(false);
      expect(command({ condition }).success).toBe(false);
    });

    it("refuses a compiled form beside no where", () => {
      const condition = { type: "span", compiledWhere: COMPILED, from: "2026-10-01T00:00:00.000Z" };

      expect(attach({ condition }).success).toBe(false);
    });
  });

  describe("when a source other than a braid carries a span condition", () => {
    /** @scenario "Only a braid writes a span condition" */
    it("refuses it from every other source, which keeps its trace read", () => {
      const span = { type: "span", from: "2026-10-01T00:00:00.000Z" };
      const sources = GRANT_EVENT_SOURCES.filter((source) => source !== "braid");

      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(attach({ source, condition: span, replacesGrantId: undefined }).success).toBe(false);
        expect(command({ source, condition: span, replacesGrantId: undefined }).success).toBe(
          false,
        );
        expect(
          attach({ source, condition: { ...span, type: "trace" }, replacesGrantId: undefined })
            .success,
        ).toBe(true);
      }
    });

    it("refuses a compiled where on any other source's read", () => {
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

  describe("when a grant that is not a braid names a grant it replaces", () => {
    it("refuses the grant a braid replaces on any other source's grant", () => {
      const trace = { type: "trace", from: "2026-10-01T00:00:00.000Z" };
      const sources = GRANT_EVENT_SOURCES.filter((source) => source !== "braid");

      for (const source of sources) {
        expect(attach({ source, condition: trace }).success).toBe(false);
        expect(command({ source, condition: trace }).success).toBe(false);
        expect(attach({ source, condition: trace, replacesGrantId: undefined }).success).toBe(true);
      }
    });
  });

  describe("when a braid is anything but the shared span read", () => {
    it("refuses one on the reader's own project, with another role, or on a trace window", () => {
      expect(attach({ scope: { type: "PROJECT", id: "proj_orchestrator" } }).success).toBe(false);
      expect(attach({ roleKey: "admin" }).success).toBe(false);
      expect(
        attach({ condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" } }).success,
      ).toBe(false);
    });
  });
});
