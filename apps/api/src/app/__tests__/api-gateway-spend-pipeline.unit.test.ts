/**
 * The producer registration the Go data plane's billing records land on.
 *
 * Two properties are worth pinning and neither is visible from the door. The
 * first is that this tier registers the REAL definition — same pipeline name,
 * same aggregate, same four commands — because the routing triple every job
 * carries is derived from those names, and a fork here would enqueue jobs the
 * worker cannot route. The second is that it registers NO process manager: the
 * definition the worker registers mounts three, two of which write a
 * customer's money and ship their webhooks, and an API process that mounted
 * them would be draining the queue the worker is scheduled to drain.
 *
 * @see apps/api/src/app/api-gateway-spend-pipeline.composition.ts
 */
// @vitest-environment node
import type { EventSourcing } from "@langwatch/eventing";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_PIPELINE_NAME,
} from "@langwatch/gateway-server";
import { describe, expect, it, vi } from "vitest";

import {
  ApiGatewaySpendPipelineAbsenceReport,
  composeApiGatewaySpendPipeline,
} from "../api-gateway-spend-pipeline.composition";

const PROCESS_NAME = "langwatch-api-test";

/** What one registered command dispatcher looks like to the doors. */
function testCommandSenders() {
  return {
    admitSpend: { send: vi.fn(async () => undefined) },
    confirmSpend: { send: vi.fn(async () => undefined) },
    failSpend: { send: vi.fn(async () => undefined) },
    settleSpend: { send: vi.fn(async () => undefined) },
  };
}

/**
 * A runtime that records what it was asked to register.
 *
 * The double is the RUNTIME rather than the definition, so the definition
 * under test is the one production registers.
 */
function testEventing(commands: Record<string, unknown>) {
  const register = vi.fn((definition: unknown) => ({ definition, commands }));
  return { eventing: { register } as unknown as EventSourcing, register };
}

class RecordingAbsence extends ApiGatewaySpendPipelineAbsenceReport {
  readonly reported: string[] = [];

  withoutQueue(): void {
    this.reported.push("no-queue");
  }
}

describe("the API's gateway-spend producer registration", () => {
  describe("given a process that composed a queue", () => {
    /** @scenario "The tier that ingests registers the pipeline as a producer only" */
    it("registers the worker's own definition with no process manager on it", () => {
      const { eventing, register } = testEventing(testCommandSenders());

      composeApiGatewaySpendPipeline({ eventing, processName: PROCESS_NAME });

      expect(register).toHaveBeenCalledTimes(1);
      const definition = register.mock.calls[0]?.[0] as {
        metadata: { name: string; aggregateType: string };
        processManagers: Map<string, unknown>;
        commands: Array<{ name: string }>;
      };
      expect(definition.metadata.name).toBe(GATEWAY_SPEND_PIPELINE_NAME);
      expect(definition.metadata.aggregateType).toBe(GATEWAY_SPEND_AGGREGATE_TYPE);
      expect(definition.commands.map((command) => command.name).sort()).toEqual([
        "admitSpend",
        "confirmSpend",
        "failSpend",
        "settleSpend",
      ]);
      expect(definition.processManagers.size).toBe(0);
    });

    it("publishes the three commands the drained batch becomes, and not the sweeper's", () => {
      const commands = testCommandSenders();
      const { eventing } = testEventing(commands);

      const pipeline = composeApiGatewaySpendPipeline({ eventing, processName: PROCESS_NAME });

      expect(Object.keys(pipeline?.commands ?? {}).sort()).toEqual([
        "admitSpend",
        "confirmSpend",
        "failSpend",
      ]);
    });

    it("confirms a settled voice session through the same registration", async () => {
      const commands = testCommandSenders();
      const { eventing } = testEventing(commands);

      const pipeline = composeApiGatewaySpendPipeline({ eventing, processName: PROCESS_NAME });
      await pipeline?.confirmation.confirmSpend({
        gateway_request_id: "gwreq_1",
      } as never);

      expect(commands.confirmSpend.send).toHaveBeenCalledWith({
        gateway_request_id: "gwreq_1",
      });
    });

    it("fails at boot when the registration produced no confirmation sender", () => {
      const { confirmSpend: _confirmSpend, ...withoutConfirm } = testCommandSenders();
      const { eventing } = testEventing(withoutConfirm);

      expect(() => composeApiGatewaySpendPipeline({ eventing, processName: PROCESS_NAME })).toThrow(
        /no "confirmSpend" command sender/,
      );
    });
  });

  describe("given a process that composed no queue", () => {
    it("reports the absence and produces nothing, so the door refuses by name", () => {
      const report = new RecordingAbsence();

      const pipeline = composeApiGatewaySpendPipeline({
        eventing: undefined,
        processName: PROCESS_NAME,
        report,
      });

      expect(pipeline).toBeUndefined();
      expect(report.reported).toEqual(["no-queue"]);
    });
  });
});
