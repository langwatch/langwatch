/**
 * @vitest-environment node
 * Which process registers trace_processing: producer-only vs. draining with
 * subscribers/folds. See trace-processing-registration-ownership.feature.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing } from "@langwatch/eventing";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type { TraceSpanDedupConnection } from "../../services/trace-span-dedup.service.ts";
import {
  buildTraceCollaborators,
  buildTraceProcessRegistrationCommands,
} from "../trace-composition.build.ts";

const { logger: silentLogger } = createTestLogger();

/**
 * An `EventSourcing` that records what a composition asked of it.
 * `getPipeline` answers only what has been registered, exactly as the real
 * one does — a lookup before install throws rather than answering emptily.
 */
function recordingRuntime() {
  const registered: string[] = [];
  const sent: { command: string; data: unknown }[] = [];
  const commands: Record<string, unknown> = {};
  const senderFor = (name: string) => ({
    send: (data: unknown) => {
      sent.push({ command: name, data });
      return Promise.resolve(null);
    },
  });
  const runtime = {
    register: (definition: { metadata: { name: string }; commands: { name: string }[] }) => {
      registered.push(definition.metadata.name);
      return {
        commands: Object.fromEntries(
          definition.commands.map((command) => [command.name, senderFor(command.name)]),
        ),
      };
    },
    getPipeline: (name: string) => {
      if (registered.includes(name)) return { commands };
      throw new Error(`Pipeline "${name}" not found. Available: ${registered.join(", ")}`);
    },
  };

  return {
    eventing: runtime as unknown as EventSourcing,
    registered,
    sent,
    /** The install phase, as far as a command sender can observe it. */
    installProcessRegistration: (commandNames: readonly string[]) => {
      registered.push("trace_processing");
      for (const name of commandNames) commands[name] = senderFor(name);
    },
  };
}

/** The dedup claim, which nothing in this suite reaches. */
function unreachableDedupConnection(): TraceSpanDedupConnection {
  const unreachable = () => {
    throw new Error("this suite ingests no span, so it claims no dedup key");
  };
  return { set: unreachable, del: unreachable };
}

function collaboratorsFor(input: {
  eventing: EventSourcing;
  registersProcessingPipeline: boolean;
}) {
  return buildTraceCollaborators({
    members: {
      clickhouse: {} as ClickHouseQueryClient,
      eventing: input.eventing,
      logger: silentLogger,
      // This suite observes pipeline registration, and no span is ingested in
      // it; the claim is never reached.
      redis: unreachableDedupConnection(),
    },
    config: {
      processName: input.registersProcessingPipeline ? "langwatch-api" : "langwatch:worker",
      fallbackVisibilityDays: 14,
      registersProcessingPipeline: input.registersProcessingPipeline,
    },
  });
}

describe("given a process in Trace's producer role", () => {
  describe("when it composes Trace", () => {
    /** @scenario "The producing process registers the pipeline it stages commands on" */
    it("registers the trace_processing pipeline exactly once", () => {
      const runtime = recordingRuntime();

      collaboratorsFor({ eventing: runtime.eventing, registersProcessingPipeline: true });

      expect(runtime.registered).toEqual(["trace_processing"]);
    });
  });
});

describe("given a process that drains the trace_processing pipeline", () => {
  describe("when it composes Trace before its install phase", () => {
    /** @scenario "The draining process registers no second pipeline" */
    it("registers nothing", () => {
      const runtime = recordingRuntime();

      collaboratorsFor({ eventing: runtime.eventing, registersProcessingPipeline: false });

      expect(runtime.registered).toEqual([]);
    });

    /** @scenario "A command sent before the install phase names the missing registration" */
    it("refuses a command sent before anything registered the pipeline", async () => {
      const runtime = recordingRuntime();
      const collaborators = collaboratorsFor({
        eventing: runtime.eventing,
        registersProcessingPipeline: false,
      });

      await expect(collaborators.commands.recordSpan({} as never)).rejects.toThrow(
        /trace_processing/,
      );
    });
  });

  describe("when its install phase has registered the complete definition", () => {
    /** @scenario "Trace's commands reach the registration the process made" */
    it("sends every command through the process's own registration", async () => {
      const runtime = recordingRuntime();
      const collaborators = collaboratorsFor({
        eventing: runtime.eventing,
        registersProcessingPipeline: false,
      });
      runtime.installProcessRegistration([
        "recordSpan",
        "addAnnotation",
        "removeAnnotation",
        "changeTraceName",
      ]);

      await collaborators.commands.recordSpan({ span: "one" } as never);
      await collaborators.commands.addAnnotation({} as never);
      await collaborators.commands.removeAnnotation({} as never);
      // The rename is the processing role's own command: the producer shape
      // refuses it because no consumer on that process folds the event, and
      // this shape answers it because this process is the consumer.
      await collaborators.commands.changeTraceName({} as never);

      expect(runtime.sent.map((entry) => entry.command)).toEqual([
        "recordSpan",
        "addAnnotation",
        "removeAnnotation",
        "changeTraceName",
      ]);
      expect(runtime.registered).toEqual(["trace_processing"]);
    });

    /** @scenario "A command the process's registration does not declare refuses by name" */
    it("refuses a command the registration does not declare", async () => {
      const runtime = recordingRuntime();
      const commands = buildTraceProcessRegistrationCommands({
        eventing: runtime.eventing,
        processName: "langwatch:worker",
      });
      runtime.installProcessRegistration(["recordSpan"]);

      await expect(commands.changeTraceName({} as never)).rejects.toMatchObject({
        code: "service_unavailable",
      });
    });
  });
});
