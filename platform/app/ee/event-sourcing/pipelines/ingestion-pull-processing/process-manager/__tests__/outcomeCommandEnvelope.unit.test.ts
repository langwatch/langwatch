// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether every outcome an ingestion pull records is a payload its command
 * will actually accept.
 *
 * The six outcome commands are resolved late, through a mutable holder filled
 * once the pipeline exists (`ee/event-sourcing/pipelineSet.ts`), and that seam
 * carried an `as never` on each dispatch. A cast there removes the only check
 * standing between an incomplete payload and `queueManager`'s pre-send
 * `schema.validate`, which throws — the pull run or listing then reports its
 * outcome into nothing, no event reaches the log, and the run status row is
 * left claiming a run that started and never ended. #8111 is that failure on
 * the sibling pulled-usage pipeline: a withdrawal dispatched without
 * `tenantId` or `occurredAt` was rejected at send time and lost.
 *
 * The casts are gone and the compiler now covers the shape, but two things it
 * cannot see are exactly what this pins:
 *
 * - Value constraints. `sourceId`, `runId`, `requestId` and `reason` are
 *   `.min(1)`, and `status` is `.int()`. A handler that passes an empty string
 *   type-checks and is rejected at send.
 * - Drift in `commands.ts`. The assertion runs `Command.schema.validate`, the
 *   SAME object `queueManager` calls before it enqueues, taken off the real
 *   command class — not a schema rebuilt here that could agree with the
 *   handler while production disagrees with both.
 *
 * Neither existing suite closes this, and between them they are each half of
 * it: `__tests__/commands.unit.test.ts` validates hand-written literals, so it
 * proves the schemas behave but never that a handler produces something they
 * accept; the effect suites beside this file mock the commands and assert the
 * cell each was handed, which says nothing about whether the command takes it.
 * A payload has to come out of the real handler AND go into the real schema,
 * which is what this does.
 *
 * Decision: ADR-052, ADR-054.
 */

import { describe, expect, it } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";

import {
  RecordIngestionPullAgentsListedCommand,
  RecordIngestionPullAgentsListingRefusedCommand,
  RecordIngestionPullPeopleListedCommand,
  RecordIngestionPullPeopleListingRefusedCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "../../commands";
import {
  createAgentListingHandler,
  createIngestionPullRunHandler,
  createPeopleListingHandler,
  type IngestionPullDispatchDeps,
  type IngestionPullOutcomeCommands,
} from "../ingestionPullEffects";
import { INGESTION_PULL_PROCESS_NAME } from "../ingestionPullProcess.types";

/**
 * The pre-send predicate, per command, taken off the command class itself.
 * `queueManager` reaches for `handlerClass.schema` and calls this exact
 * `validate` before it enqueues anything.
 */
const COMMAND_SCHEMAS = {
  recordRunCompleted: RecordIngestionPullRunCompletedCommand.schema,
  recordRunFailed: RecordIngestionPullRunFailedCommand.schema,
  recordAgentsListed: RecordIngestionPullAgentsListedCommand.schema,
  recordAgentsListingRefused:
    RecordIngestionPullAgentsListingRefusedCommand.schema,
  recordPeopleListed: RecordIngestionPullPeopleListedCommand.schema,
  recordPeopleListingRefused:
    RecordIngestionPullPeopleListingRefusedCommand.schema,
} as const;

type OutcomeCommandName = keyof typeof COMMAND_SCHEMAS;

const TENANT_ID = "proj-gov-ingestion-pull";

const context = (attempt: number): IntentContext => ({
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: TENANT_ID,
  processKey: "source-1",
  tenantId: TENANT_ID,
  messageKey: "process:source-1:pull:run-1",
  attempt,
});

const runIntent = {
  sourceId: "source-1",
  runId: "run-1",
  scheduledFor: 100,
  cursor: "cursor-1",
};

const listingIntent = {
  sourceId: "source-1",
  requestId: "request-1",
  requestedAt: 100,
};

/**
 * Captures what each command was handed, keeping the real parameter types so
 * the handlers are type-checked against the interface exactly as they are in
 * the composition root.
 */
function recordingCommands(): {
  commands: IngestionPullOutcomeCommands;
  dispatched: { command: OutcomeCommandName; payload: unknown }[];
} {
  const dispatched: { command: OutcomeCommandName; payload: unknown }[] = [];
  const capture =
    <Args>(command: OutcomeCommandName) =>
    async (payload: Args): Promise<void> => {
      dispatched.push({ command, payload });
    };
  return {
    commands: {
      recordRunCompleted: capture("recordRunCompleted"),
      recordRunFailed: capture("recordRunFailed"),
      recordAgentsListed: capture("recordAgentsListed"),
      recordAgentsListingRefused: capture("recordAgentsListingRefused"),
      recordPeopleListed: capture("recordPeopleListed"),
      recordPeopleListingRefused: capture("recordPeopleListingRefused"),
    },
    dispatched,
  };
}

/**
 * The issues the real command schema raises over what was dispatched, as
 * `command: path` strings.
 *
 * Reported rather than asserted bare: a rejection here is the whole defect,
 * and the field that would be dropped is the thing worth reading in the diff
 * of a failure.
 */
function rejections(
  dispatched: { command: OutcomeCommandName; payload: unknown }[],
): string[] {
  return dispatched.flatMap(({ command, payload }) => {
    const result = COMMAND_SCHEMAS[command].validate(payload);
    return result.success
      ? []
      : result.error.issues.map(
          (issue) => `${command}: ${issue.path.join(".")}`,
        );
  });
}

function completedRun() {
  return {
    nextCursor: "cursor-2",
    eventCount: 3,
    errorCount: 0,
    completeness: "complete" as const,
    readThroughAt: 1_699_000_000_000,
  };
}

function dispatchDeps(
  commands: IngestionPullOutcomeCommands,
  ports: Partial<
    Pick<
      IngestionPullDispatchDeps,
      "runPort" | "agentListingPort" | "peopleListingPort"
    >
  >,
): IngestionPullDispatchDeps {
  return {
    runPort: ports.runPort ?? { run: async () => completedRun() },
    agentListingPort: ports.agentListingPort ?? {
      list: async () => ({ outcome: "listed" as const, agentCount: 0 }),
    },
    peopleListingPort: ports.peopleListingPort ?? {
      list: async () => ({
        outcome: "listed" as const,
        directoryPersonCount: 0,
        withheldPersonCount: 0,
      }),
    },
    commands: () => commands,
    clock: () => 1_700_000_000_000,
  };
}

describe("recording an ingestion pull outcome", () => {
  describe("when a run completes", () => {
    it("hands the command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createIngestionPullRunHandler(dispatchDeps(commands, {}))(
        runIntent,
        context(1),
      );

      expect(dispatched.map((d) => d.command)).toEqual(["recordRunCompleted"]);
      expect(rejections(dispatched)).toEqual([]);
    });

    it("dates the outcome and names the tenant the run belongs to", async () => {
      const { commands, dispatched } = recordingCommands();

      await createIngestionPullRunHandler(dispatchDeps(commands, {}))(
        runIntent,
        context(1),
      );

      expect(dispatched[0]?.payload).toMatchObject({
        tenantId: TENANT_ID,
        occurredAt: 1_700_000_000_000,
        sourceId: "source-1",
        runId: "run-1",
      });
    });
  });

  describe("when a run takes over from one that outlived its allowance", () => {
    it("hands both the abandonment and the completion payloads the commands accept", async () => {
      const { commands, dispatched } = recordingCommands();

      await createIngestionPullRunHandler(dispatchDeps(commands, {}))(
        { ...runIntent, abandonedRunId: "run-0" },
        context(1),
      );

      expect(dispatched.map((d) => d.command)).toEqual([
        "recordRunFailed",
        "recordRunCompleted",
      ]);
      expect(rejections(dispatched)).toEqual([]);
    });
  });

  describe("when the provider refuses the source outright", () => {
    it("hands the command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();
      // With a `customerMessage`, so this takes the `pull_refused` arm whose
      // text the source page shows as written — the other arm is covered by
      // the exhausted run below.
      const refusal = new DispatchError({
        message: "provider returned 401 for source-1",
        retryable: false,
        customerMessage: "This source's credential was rejected.",
      });

      await createIngestionPullRunHandler(
        dispatchDeps(commands, {
          runPort: {
            run: async () => {
              throw refusal;
            },
          },
        }),
      )(runIntent, context(1));

      expect(dispatched.map((d) => d.command)).toEqual(["recordRunFailed"]);
      expect(rejections(dispatched)).toEqual([]);
    });
  });

  describe("when a run exhausts its attempts", () => {
    it("hands the command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createIngestionPullRunHandler(
        dispatchDeps(commands, {
          runPort: {
            run: async () => {
              throw new Error("provider timed out");
            },
          },
        }),
      )(runIntent, context(3));

      expect(dispatched.map((d) => d.command)).toEqual(["recordRunFailed"]);
      expect(rejections(dispatched)).toEqual([]);
    });
  });

  describe("when a listing answers", () => {
    it("hands the agents command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createAgentListingHandler(
        dispatchDeps(commands, {
          agentListingPort: {
            list: async () => ({ outcome: "listed", agentCount: 7 }),
          },
        }),
      )(listingIntent, context(1));

      expect(dispatched.map((d) => d.command)).toEqual(["recordAgentsListed"]);
      expect(rejections(dispatched)).toEqual([]);
    });

    it("hands the people command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createPeopleListingHandler(
        dispatchDeps(commands, {
          peopleListingPort: {
            list: async () => ({
              outcome: "listed",
              directoryPersonCount: 12,
              withheldPersonCount: 2,
            }),
          },
        }),
      )(listingIntent, context(1));

      expect(dispatched.map((d) => d.command)).toEqual(["recordPeopleListed"]);
      expect(rejections(dispatched)).toEqual([]);
    });
  });

  describe("when a listing is refused by the provider", () => {
    it("hands the agents refusal command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createAgentListingHandler(
        dispatchDeps(commands, {
          agentListingPort: {
            list: async () => ({
              outcome: "refused",
              reason: "not_entitled",
              status: 403,
            }),
          },
        }),
      )(listingIntent, context(1));

      expect(dispatched.map((d) => d.command)).toEqual([
        "recordAgentsListingRefused",
      ]);
      expect(rejections(dispatched)).toEqual([]);
    });

    it("hands the people refusal command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createPeopleListingHandler(
        dispatchDeps(commands, {
          peopleListingPort: {
            list: async () => ({
              outcome: "refused",
              reason: "not_entitled",
              status: null,
            }),
          },
        }),
      )(listingIntent, context(1));

      expect(dispatched.map((d) => d.command)).toEqual([
        "recordPeopleListingRefused",
      ]);
      expect(rejections(dispatched)).toEqual([]);
    });
  });

  describe("when a listing cannot be asked at all and its attempts are spent", () => {
    it("hands the refusal command a payload the command schema accepts", async () => {
      const { commands, dispatched } = recordingCommands();

      await createAgentListingHandler(
        dispatchDeps(commands, {
          agentListingPort: {
            list: async () => {
              throw new Error("network unreachable");
            },
          },
        }),
      )(listingIntent, context(3));

      expect(dispatched.map((d) => d.command)).toEqual([
        "recordAgentsListingRefused",
      ]);
      expect(rejections(dispatched)).toEqual([]);
    });
  });
});
