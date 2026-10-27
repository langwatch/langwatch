/**
 * @vitest-environment node
 * A crash replay of a command job re-runs its handler; keying the appended
 * events on the stable job id lets the event log collapse the second append.
 * See specs/durable-handoff.feature.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Command, CommandHandler } from "../../../commands/command.ts";
import type { Event } from "../../../domain/types.ts";
import {
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers.ts";
import {
  type ProcessCommandParams,
  processCommand,
  processCommandBatch,
} from "../commandDispatcher.ts";

const tenantId = createTestTenantId();
const aggregateType = TEST_CONSTANTS.AGGREGATE_TYPE;

const testPayloadSchema = z.object({
  tenantId: z.string(),
  occurredAt: z.number(),
  id: z.string().optional(),
});
type TestPayload = z.infer<typeof testPayloadSchema>;

/** Each run mints fresh event ids, as a real handler re-run after a crash does. */
function handlerMinting({ declaredKey }: { declaredKey?: string } = {}): CommandHandler<
  Command<TestPayload>,
  Event
> {
  return {
    handle: async (command) => {
      const minted = [
        createTestEvent(command.aggregateId, aggregateType, tenantId),
        createTestEvent(command.aggregateId, aggregateType, tenantId),
      ];
      return declaredKey
        ? minted.map((event, index) => ({ ...event, idempotencyKey: `${declaredKey}:${index}` }))
        : minted;
    },
  };
}

function commandParams({ handler }: { handler: CommandHandler<Command<TestPayload>, Event> }): {
  appends: Event[][];
  params: Omit<ProcessCommandParams<Event, TestPayload>, "payload">;
} {
  const appends: Event[][] = [];
  return {
    appends,
    params: {
      commandType: "test.command.run",
      commandSchema: {
        type: "test.command.run",
        validate: (value) => testPayloadSchema.safeParse(value),
      },
      handler,
      getAggregateId: (payload) => payload.id ?? TEST_CONSTANTS.AGGREGATE_ID,
      storeEventsFn: async (events) => {
        appends.push(events);
      },
      aggregateType,
      commandName: "run",
      pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    },
  };
}

const payload: TestPayload = { tenantId: TEST_CONSTANTS.TENANT_ID_VALUE, occurredAt: 1 };

describe("keying a command's appended events on its queue job", () => {
  describe("given a handler that declares no event key", () => {
    describe("when the same queue job runs the command twice", () => {
      /** @scenario "A crash replay of a command without a declared key collapses onto the first append" */
      it("keys both appends on the job id and position", async () => {
        const { appends, params } = commandParams({ handler: handlerMinting() });

        await processCommand({ ...params, payload, jobId: "job-7/command/run" });
        await processCommand({ ...params, payload, jobId: "job-7/command/run" });

        const [first, replay] = appends;
        expect(first?.map((event) => event.idempotencyKey)).toEqual([
          "job-7/command/run:0",
          "job-7/command/run:1",
        ]);
        expect(replay?.map((event) => event.idempotencyKey)).toEqual(
          first?.map((event) => event.idempotencyKey),
        );
        expect(replay?.[0]?.id).not.toBe(first?.[0]?.id);
      });
    });
  });

  describe("given a handler that declares its own event key", () => {
    describe("when the same queue job runs the command twice", () => {
      /** @scenario "A command's declared event key survives the crash replay unchanged" */
      it("keeps the handler's key on both appends", async () => {
        const { appends, params } = commandParams({
          handler: handlerMinting({ declaredKey: "declared" }),
        });

        await processCommand({ ...params, payload, jobId: "job-8/command/run" });
        await processCommand({ ...params, payload, jobId: "job-8/command/run" });

        for (const append of appends) {
          expect(append.map((event) => event.idempotencyKey)).toEqual(["declared:0", "declared:1"]);
        }
      });
    });
  });

  describe("given two commands coalesced into one batch", () => {
    /** @scenario "A coalesced batch keys each command's events on its own job" */
    it("keys each command's events on its own job id", async () => {
      const { appends, params } = commandParams({ handler: handlerMinting() });

      await processCommandBatch({
        ...params,
        payloads: [
          { ...payload, id: "a" },
          { ...payload, id: "b" },
        ],
        jobIds: ["job-a", "job-b"],
      });

      expect(appends[0]?.map((event) => event.idempotencyKey)).toEqual([
        "job-a:0",
        "job-a:1",
        "job-b:0",
        "job-b:1",
      ]);
    });
  });
});
