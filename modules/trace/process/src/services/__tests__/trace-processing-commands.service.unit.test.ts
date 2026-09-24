import type { EventingCommands } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { TraceProcessingPipelineDefinition } from "../../app/trace.members.ts";
import { TraceProcessingCommandsService } from "../trace-processing-commands.service.ts";

type Sent = { command: string; payload: unknown };

function connectedSenders(log: Sent[]): EventingCommands<TraceProcessingPipelineDefinition> {
  const recording = <Payload>(command: string) => ({
    send: async (payload: Payload) => {
      log.push({ command, payload });
    },
    sendBatch: async () => void 0,
    close: async () => void 0,
    waitUntilReady: async () => void 0,
  });
  return {
    recordSpan: recording("recordSpan"),
    assignTopic: recording("assignTopic"),
    recordLogContribution: recording("recordLogContribution"),
    recordMetricCorrelation: recording("recordMetricCorrelation"),
    resolveOrigin: recording("resolveOrigin"),
    addAnnotation: recording("addAnnotation"),
    removeAnnotation: recording("removeAnnotation"),
    bulkSyncAnnotations: recording("bulkSyncAnnotations"),
    changeTraceName: recording("changeTraceName"),
  };
}

const base = { tenantId: "project-1", traceId: "trace-1", occurredAt: 1_700_000_000_000 };

describe("TraceProcessingCommandsService", () => {
  describe("given trace_processing has not connected its senders", () => {
    /** @scenario "A command sent before the pipeline is connected names the missing command" */
    it("refuses by name, naming the command", async () => {
      const commands = TraceProcessingCommandsService.create({ processName: "langwatch-api" });

      await expect(
        commands.addAnnotation({ ...base, annotationId: "annotation-1" }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        meta: {
          process: "langwatch-api",
          capability: 'the trace_processing "addAnnotation" command',
        },
      });
    });
  });

  describe("given trace_processing has connected its senders", () => {
    /** @scenario "Trace's commands reach the senders the process connected" */
    it("sends each command through the connected sender of the same name", async () => {
      const log: Sent[] = [];
      const commands = TraceProcessingCommandsService.create({ processName: "langwatch-worker" });
      commands.connect(connectedSenders(log));

      await commands.addAnnotation({ ...base, annotationId: "annotation-1" });
      await commands.removeAnnotation({ ...base, annotationId: "annotation-1" });
      await commands.changeTraceName({ ...base, newName: "renamed", changedByUserId: null });

      expect(log.map((sent) => sent.command)).toEqual([
        "addAnnotation",
        "removeAnnotation",
        "changeTraceName",
      ]);
      expect(log[2]!.payload).toMatchObject({ newName: "renamed", traceId: "trace-1" });
    });
  });
});
