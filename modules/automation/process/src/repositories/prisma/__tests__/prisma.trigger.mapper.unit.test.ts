/**
 * Rows written by the previous release hold `filters` / `actionParams` as
 * JSON-encoded strings inside the jsonb column. The mapper unwraps them.
 * Spec: modules/automation/specs/automation.feature (trigger JSON text)
 */
import { describe, expect, it } from "vitest";

import { mapTriggerRow } from "../prisma.trigger.mapper.ts";

const AT = new Date("2026-10-01T00:00:00.000Z");

const baseRow = {
  id: "trigger-1",
  projectId: "project-1",
  name: "Error rate",
  action: "SEND_EMAIL",
  triggerKind: "ALERT",
  actionParams: { members: ["ada@example.com"], threshold: 10 },
  filters: {},
  filterQuery: null,
  active: true,
  deleted: false,
  pausedReason: null,
  pausedAt: null,
  message: null,
  alertType: null,
  customGraphId: "graph-1",
  notificationCadence: "immediate",
  traceDebounceMs: 0,
  slackTemplateType: null,
  slackTemplate: null,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  createdAt: AT,
  updatedAt: AT,
  lastRunAt: null,
};

const row = (overrides: Record<string, unknown>) => ({ ...baseRow, ...overrides });

describe("mapTriggerRow", () => {
  describe("given filters stored as a JSON-encoded string", () => {
    /** @scenario "A trigger whose filters or action params are stored as JSON text reads as the object" */
    it("unwraps an object string", () => {
      const trigger = mapTriggerRow(row({ filters: '{"topics":["a"]}' }));
      expect(trigger.filters).toEqual({ topics: ["a"] });
    });

    it("unwraps an empty object string", () => {
      expect(mapTriggerRow(row({ filters: "{}" })).filters).toEqual({});
    });

    /** @scenario "A trigger whose filters or action params are stored as JSON text reads as the object" */
    it.each(["not json", "[1,2]", "42", "null", '"x"', ""])(
      "falls back to {} for %j without throwing",
      (filters) => {
        expect(mapTriggerRow(row({ filters })).filters).toEqual({});
      },
    );
  });

  describe("given actionParams stored as a JSON-encoded string", () => {
    it("unwraps an object string", () => {
      const trigger = mapTriggerRow(row({ actionParams: '{"url":"https://hooks.example.com"}' }));
      expect(trigger.actionParams).toEqual({ url: "https://hooks.example.com" });
    });

    it("falls back to {} for a non-object string", () => {
      expect(mapTriggerRow(row({ actionParams: "oops" })).actionParams).toEqual({});
    });
  });

  describe("given native objects", () => {
    it("passes them through unchanged", () => {
      const trigger = mapTriggerRow(row({ filters: { a: ["b"] }, actionParams: { k: 1 } }));
      expect(trigger.filters).toEqual({ a: ["b"] });
      expect(trigger.actionParams).toEqual({ k: 1 });
    });

    it("reads null as {}", () => {
      const trigger = mapTriggerRow(row({ filters: null, actionParams: null }));
      expect(trigger.filters).toEqual({});
      expect(trigger.actionParams).toEqual({});
    });
  });
});
