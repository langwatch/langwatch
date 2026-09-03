import { readFileSync } from "node:fs";
import { LangyTitleModelPort } from "@langwatch/langy-server";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  createWorkerLangyConversation,
  WorkerLangyAbsenceReportPort,
} from "../worker-langy-conversation.composition";
import { createWorkerProcessDatabase } from "./support/worker-database.double";

/**
 * Spec: specs/langy/worker-langy-conversation-conversion.feature
 *
 * THE CONVERSION, asserted where it can actually fail. The pipeline used to
 * arrive from the application as a definition this process merely re-registered;
 * nothing in that shape could tell a graph that reaches its collaborators from
 * one that was handed in. So every assertion here builds the real definition
 * from substrates and drives a registered handler, observing the effect at the
 * far end: a conversation update on the tenant's own channel, an analytics row
 * on ClickHouse with the columns the table actually has, and the two named
 * absences refusing where a silent answer would have been indistinguishable.
 */

const RECORDED: {
  published: Array<{ channel: string; message: string }>;
  inserted: Array<{ table: string; values: readonly unknown[]; settings: unknown }>;
  absences: string[];
} = { published: [], inserted: [], absences: [] };

function reset(): void {
  RECORDED.published.length = 0;
  RECORDED.inserted.length = 0;
  RECORDED.absences.length = 0;
}

class RecordingAbsence extends WorkerLangyAbsenceReportPort {
  withoutAgentManager(): void {
    RECORDED.absences.push("agentManager");
  }
  withoutTitleGeneration(): void {
    RECORDED.absences.push("titleGeneration");
  }
  withoutSessionKeyMint(): void {
    RECORDED.absences.push("sessionKeyMint");
  }
}

/** The two Redis verbs the token buffer and handoff store reach on this path. */
function redisDouble() {
  return {
    publish: async (channel: string, message: string) => {
      RECORDED.published.push({ channel, message });
      return 1;
    },
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    xadd: async () => "0-0",
    expire: async () => 1,
  };
}

function clickHouseDouble() {
  return async () => ({
    insert: async (input: {
      table: string;
      values: readonly unknown[];
      clickhouse_settings?: unknown;
    }) => {
      RECORDED.inserted.push({
        table: input.table,
        values: input.values,
        settings: input.clickhouse_settings,
      });
      return undefined;
    },
  });
}

/**
 * A model gateway that answers, without one existing.
 *
 * Only the composition decision is under test here: whether the process wires
 * `@langwatch/langy-server`'s own generator or reports the absence. What the
 * generator DOES with a handle is that service's own suite, which is where the
 * prompt, the character budget and the failure contract live.
 */
class FakeTitleModel extends LangyTitleModelPort {
  resolveTitleModel(): Promise<never> {
    return Promise.reject(new Error("the composition test never resolves a model"));
  }
}

function compose(source: Record<string, unknown> = {}, titleModels?: LangyTitleModelPort) {
  return createWorkerLangyConversation({
    config: resolveWorkerConfig({ NODE_ENV: "test", ...source }),
    database: createWorkerProcessDatabase() as never,
    redis: redisDouble() as never,
    resolveClickHouseClient: clickHouseDouble(),
    defaultRetentionDays: 90,
    broadcast: {
      broadcastToTenant: async (input: { tenantId: string; event: string; eventType: string }) => {
        RECORDED.published.push({
          channel: `broadcast:${input.eventType}`,
          message: JSON.stringify({ tenantId: input.tenantId, event: input.event }),
        });
      },
    } as never,
    ...(titleModels ? { titleModels } : {}),
    absence: new RecordingAbsence(),
  });
}

/** The routing keys the frozen registry lists for `langy_conversation_processing`. */
function frozenLangyRoutingKeys(): string[] {
  const registry = JSON.parse(
    readFileSync(new URL("../../features/job-registry.json", import.meta.url), "utf8"),
  ) as { pipelines: Array<{ name: string; jobs: string[] }> };
  const pipeline = registry.pipelines.find(
    (entry) => entry.name === "langy_conversation_processing",
  );
  if (!pipeline) throw new Error("langy_conversation_processing is absent from the job registry");
  return pipeline.jobs;
}

/** What the built definition registers, in the registry's own key spelling. */
function registeredKeys(definition: {
  foldProjections: Map<string, unknown>;
  stateProjections?: Map<string, unknown>;
  mapProjections: Map<string, unknown>;
  commands: ReadonlyArray<{ name: string }>;
  foldSubscribers: Map<string, unknown>;
  mapSubscribers: Map<string, unknown>;
  eventSubscribers: Map<string, unknown>;
  processManagers: Map<string, { config: { eventTypes: readonly string[] } }>;
}): Set<string> {
  const keys = new Set<string>();
  for (const name of definition.foldProjections.keys()) keys.add(`projection:${name}`);
  for (const name of definition.stateProjections?.keys() ?? []) keys.add(`stateProjection:${name}`);
  for (const name of definition.mapProjections.keys()) keys.add(`handler:${name}`);
  for (const command of definition.commands) keys.add(`command:${command.name}`);
  for (const name of definition.foldSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.mapSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.eventSubscribers.keys()) keys.add(`subscriber:${name}`);
  for (const [name, manager] of definition.processManagers) {
    // Exactly the runtime's own rule: a schedule-only process manager
    // registers no live subscriber, so it stages no routing key.
    if (manager.config.eventTypes.length > 0) keys.add(`subscriber:pm:${name}`);
  }
  return keys;
}

describe("given the langy conversation pipeline this process composes for itself", () => {
  describe("when the composition root builds it", () => {
    /** @scenario "The worker mounts every langy conversation routing key" */
    it("registers every routing key the frozen registry lists, and no other", () => {
      reset();
      const definition = compose().buildProcessing() as never;
      const registered = registeredKeys(definition);

      const frozen = frozenLangyRoutingKeys();
      expect(frozen.filter((key) => !registered.has(key))).toEqual([]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(24);
    });

    /** @scenario "The worker mounts every langy conversation routing key" */
    it("names the pipeline and aggregate the queue routes on", () => {
      reset();
      const definition = compose().buildProcessing() as unknown as {
        metadata: { name: string };
        aggregate: { type: string };
      };

      expect(definition.metadata.name).toBe("langy_conversation_processing");
      expect(definition.aggregate.type).toBe("langy_conversation");
    });
  });

  describe("when the analytics projection appends a row", () => {
    /** @scenario "Langy analytics rows land on this process's own ClickHouse" */
    it("writes it to the langy analytics table under the tenant's own client", async () => {
      reset();
      const definition = compose().buildProcessing() as unknown as {
        mapProjections: Map<
          string,
          {
            definition: {
              store: {
                append(record: object, context: { tenantId: string }): Promise<void>;
              };
            };
          }
        >;
      };
      const analytics = definition.mapProjections.get("langyAnalyticsEvent");
      if (!analytics) throw new Error("the pipeline registered no langyAnalyticsEvent projection");

      await analytics.definition.store.append(
        {
          eventId: "evt_1",
          eventType: "lw.langy_conversation.message_recorded",
          eventVersion: "2026-01-01",
          aggregateId: "conversation-1",
          turnId: "turn-1",
          userId: "user-1",
          role: "user",
          toolName: null,
          outcome: null,
          model: null,
          durationMs: 12.6,
          occurredAtMs: 1_700_000_000_000,
          acceptedAtMs: 1_700_000_000_100,
        },
        { tenantId: "project-1" } as never,
      );

      expect(RECORDED.inserted).toHaveLength(1);
      const insert = RECORDED.inserted[0]!;
      expect(insert.table).toBe("langy_analytics_events");
      // Pinned by literal, not derived: the table this writes to compiles
      // against nothing here, so a column written under another name is
      // accepted and silently fills the real one with its default.
      expect(insert.values[0]).toEqual({
        TenantId: "project-1",
        EventId: "evt_1",
        EventType: "lw.langy_conversation.message_recorded",
        EventVersion: "2026-01-01",
        AggregateId: "conversation-1",
        TurnId: "turn-1",
        UserId: "user-1",
        Role: "user",
        ToolName: null,
        Outcome: null,
        Model: null,
        DurationMs: "13",
        OccurredAt: new Date(1_700_000_000_000),
        AcceptedAt: new Date(1_700_000_000_100),
        _retention_days: 90,
      });
      expect(insert.settings).toEqual({ async_insert: 1, wait_for_async_insert: 0 });
    });
  });

  describe("when this deployment named no agent manager", () => {
    /** @scenario "A worker without an agent manager says so at boot" */
    it("reports the absence by name rather than dispatching into nothing", () => {
      reset();
      compose();

      expect(RECORDED.absences).toContain("agentManager");
    });

    /** @scenario "A worker without an agent manager says so at boot" */
    it("stops reporting it once both variables are configured together", () => {
      reset();
      compose({
        OPENCODE_AGENT_URL: "https://agent.internal",
        LANGY_INTERNAL_SECRET: "secret",
      });

      expect(RECORDED.absences).not.toContain("agentManager");
    });

    /** @scenario "A worker without an agent manager says so at boot" */
    it("refuses half a pair rather than dispatching unauthenticated", () => {
      reset();
      expect(() => compose({ OPENCODE_AGENT_URL: "https://agent.internal" })).toThrow(
        /must be configured together/,
      );
    });
  });

  describe("when the title generator and the session-key mint are absent", () => {
    /** @scenario "Title generation and session-key minting are declared absent" */
    it("declares both by name at boot", () => {
      reset();
      compose();

      expect(RECORDED.absences).toEqual(
        expect.arrayContaining(["titleGeneration", "sessionKeyMint"]),
      );
    });
  });

  describe("when this process composed a model gateway", () => {
    /** @scenario "Title generation and session-key minting are declared absent" */
    it("stops declaring the title absence and wires the packaged generator instead", () => {
      reset();
      compose({}, new FakeTitleModel());

      expect(RECORDED.absences).not.toContain("titleGeneration");
      // The mint is a different precondition — an authorization graph, not a
      // model — so a gateway must not quieten it.
      expect(RECORDED.absences).toContain("sessionKeyMint");
    });

    /** @scenario "The worker mounts every langy conversation routing key" */
    it("registers the same routing keys it does without one", () => {
      reset();
      const withGateway = compose({}, new FakeTitleModel()).buildProcessing() as never;
      reset();
      const without = compose().buildProcessing() as never;

      expect([...registeredKeys(withGateway)].sort()).toEqual([...registeredKeys(without)].sort());
    });
  });
});
