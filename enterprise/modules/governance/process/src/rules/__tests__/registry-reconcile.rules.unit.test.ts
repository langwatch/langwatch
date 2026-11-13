/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { RegistryDraft } from "../../features/registry/rules/registry-entry.rules.ts";
import {
  planRegistryChanges,
  type RegistryChangeSet,
  type StoredRegistryEntry,
} from "../../features/registry/rules/registry-reconcile.rules.ts";

const T0 = Temporal.Instant.from("2026-11-10T09:00:00Z");
const T1 = Temporal.Instant.from("2026-11-11T09:00:00Z");

function draft(overrides: Partial<RegistryDraft> = {}): RegistryDraft {
  return {
    sourceKey: "langwatch:agent-1",
    source: "langwatch",
    management: "managed",
    shadow: false,
    kind: "connected",
    name: "Field agent",
    description: null,
    source_version: null,
    project_id: "project-1",
    environment: null,
    owner: null,
    endpoints: [],
    model: { provider: "openai", model: "gpt-5", parameters: {} },
    instructions: null,
    capabilities: ["connected"],
    tools: [
      { name: "call", description: null, input_schema: { type: "object" }, output_schema: null },
    ],
    firstSeenAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

function idsFrom(prefix: string) {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

/** Plans against what the last plan wrote, as the repository would hold it. */
function held(changes: RegistryChangeSet): StoredRegistryEntry[] {
  return changes.writes.map(({ id, sourceKey, fingerprint, entry }) => ({
    id,
    sourceKey,
    fingerprint,
    entry,
  }));
}

function registered(drafts: RegistryDraft[]) {
  return planRegistryChanges({ stored: [], drafts, now: T0, newId: idsFrom("first") });
}

describe("planRegistryChanges()", () => {
  describe("given an agent the registry does not hold", () => {
    /** @scenario A new agent is registered at version 1 */
    it("stores it at version 1 with one registered event", () => {
      const changes = registered([draft()]);

      expect(changes.writes).toHaveLength(1);
      expect(changes.writes[0]?.entry.version).toBe(1);
      expect(changes.events.map((event) => [event.type, event.toVersion])).toEqual([
        ["governance.agent.registered", 1],
      ]);
    });

    /** @scenario A shadow agent's registration also flags it shadow */
    it("flags a shadow agent in the same reconcile", () => {
      const changes = registered([
        draft({ sourceKey: "traffic:project-1:pricing-bot", shadow: true }),
      ]);

      expect(changes.events.map((event) => event.type)).toEqual([
        "governance.agent.registered",
        "governance.agent.flagged_shadow",
      ]);
    });
  });

  describe("given an agent held at version 1", () => {
    /** @scenario A material change bumps the version and the event carries both versions */
    it("bumps the version when the model changes", () => {
      const first = registered([draft()]);

      const changes = planRegistryChanges({
        stored: held(first),
        drafts: [draft({ model: { provider: "openai", model: "gpt-5-mini", parameters: {} } })],
        now: T1,
        newId: idsFrom("second"),
      });

      expect(changes.writes[0]?.entry.version).toBe(2);
      expect(
        changes.events.map((event) => [event.type, event.fromVersion, event.toVersion]),
      ).toEqual([["governance.agent.versioned", 1, 2]]);
    });

    /** @scenario A change that only moves last seen keeps the version and appends nothing */
    it("rewrites last seen and appends nothing", () => {
      const first = registered([draft()]);

      const changes = planRegistryChanges({
        stored: held(first),
        drafts: [draft({ lastSeenAt: T1 })],
        now: T1,
        newId: idsFrom("second"),
      });

      expect(changes.events).toEqual([]);
      expect(changes.writes[0]?.entry.version).toBe(1);
      expect(changes.writes[0]?.entry.last_seen_at).toBe("2026-11-11T09:00:00.000Z");
    });

    /** @scenario A read that saw an older sighting never moves last seen back */
    it("keeps the later last seen and writes nothing", () => {
      const newer = registered([draft({ lastSeenAt: T1 })]);

      const changes = planRegistryChanges({
        stored: held(newer),
        drafts: [draft({ lastSeenAt: T0 })],
        now: T1,
        newId: idsFrom("older"),
      });

      expect(changes).toEqual({ writes: [], events: [] });
    });

    /** @scenario A tool that disappears is marked deprecated, never dropped */
    it("keeps a dropped tool listed as deprecated since the new version", () => {
      const both = [
        { name: "call", description: null, input_schema: { type: "object" }, output_schema: null },
        {
          name: "search",
          description: null,
          input_schema: { type: "object" },
          output_schema: null,
        },
      ];
      const first = registered([draft({ tools: both })]);

      const changes = planRegistryChanges({
        stored: held(first),
        drafts: [draft({ tools: both.slice(0, 1) })],
        now: T1,
        newId: idsFrom("second"),
      });

      const search = changes.writes[0]?.entry.tools.find((tool) => tool.name === "search");
      expect(search).toMatchObject({ status: "deprecated", deprecated_in_version: 2 });
      expect(
        changes.events
          .filter((event) => event.type === "governance.agent.tool_deprecated")
          .map((event) => event.tool),
      ).toEqual(["search"]);
    });

    /** @scenario An archived agent is removed from the active registry with an event */
    it("removes an agent no draft names", () => {
      const first = registered([draft()]);

      const changes = planRegistryChanges({
        stored: held(first),
        drafts: [],
        now: T1,
        newId: idsFrom("second"),
      });

      expect(changes.writes[0]?.entry).toMatchObject({ status: "removed", version: 2 });
      expect(changes.events.map((event) => event.type)).toEqual(["governance.agent.removed"]);
    });
  });

  describe("when another reconcile committed after these drafts were read", () => {
    /** @scenario A reconcile whose sources were read before a newer commit plans nothing */
    it("writes and announces nothing", () => {
      const newer = registered([draft()]);

      const changes = planRegistryChanges({
        stored: held(newer),
        drafts: [],
        now: T1,
        newId: idsFrom("stale"),
        readAt: T0.subtract({ minutes: 1 }),
      });

      expect(changes).toEqual({ writes: [], events: [] });
    });
  });

  describe("when a held agent is absent but kept", () => {
    /** @scenario A traced agent last seen inside the traffic window stays when a read misses it */
    it("leaves it as it was", () => {
      const first = registered([draft({ sourceKey: "traffic:project-1:planner" })]);

      const changes = planRegistryChanges({
        stored: held(first),
        drafts: [],
        now: T1,
        newId: idsFrom("second"),
        readAt: T1,
        keep: () => true,
      });

      expect(changes).toEqual({ writes: [], events: [] });
    });
  });
});
