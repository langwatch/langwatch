import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjectionRead,
} from "@langwatch/eventing";
/**
 * The SSO connection ledger writer in the ADR-110 shape: the staged command is the sole
 * appender, so the writer holds no event log and commits from a process that only sends.
 */
import {
  CONNECTION_RENAMED_EVENT_TYPE,
  RENAME_CONNECTION_COMMAND_TYPE,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  IdentityEventing,
  IdentityPipelineCommand,
} from "../../../../eventing/identity-command-senders.store.ts";
import { SsoConnectionLedgerStore } from "../sso-connection-ledger.store.ts";
import type { SsoConnectionFoldState } from "../sso-connection-state.projection.ts";

const ORGANIZATION = "org_acme";
const CONNECTION = "conn_1";
const ACTOR = { type: "user" as const, id: "user_owner" };
const T0 = 1_690_000_000_000;

/** The projection head as the queue's fold leaves it; unconverged answers empty forever. */
class ConvergedProjection implements StateProjectionStore<SsoConnectionFoldState> {
  constructor(private readonly converged: boolean) {}
  readonly reads: string[] = [];

  async get(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<SsoConnectionFoldState>> {
    this.reads.push(key);
    if (!this.converged) return { kind: "empty" };
    return {
      kind: "folded",
      projection: {
        state: {} as SsoConnectionFoldState,
        cursor: { acceptedAt: Number.MAX_SAFE_INTEGER, eventId: "zzz" },
        occurredAt: T0,
        createdAt: T0,
        updatedAt: T0,
        version: "1",
      },
    };
  }

  async store(): Promise<void> {
    throw new Error("the ledger wrote a projection, which is the queue's work");
  }
}

/** The senders the process connected, recording what the ledger asked for and staged. */
class RecordingEventing implements IdentityEventing {
  readonly asked: { pipeline: string; command: string }[] = [];
  readonly staged: unknown[] = [];

  constructor(private readonly registered: boolean) {}

  async resolvePipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<IdentityPipelineCommand> {
    this.asked.push(input);
    if (!this.registered) return { kind: "unregistered" };
    return {
      kind: "registered",
      sender: {
        send: async (data: unknown) => {
          this.staged.push(data);
          return undefined;
        },
      },
    };
  }
}

function renameConnection(): { command: SsoConnectionCommand; facts: SsoConnectionFactInput[] } {
  return {
    command: {
      type: RENAME_CONNECTION_COMMAND_TYPE,
      data: {
        tenantId: ORGANIZATION,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        commandId: "cmd_1",
        occurredAtMs: T0,
        actor: ACTOR,
        source: "self-serve",
        name: "ACME Keycloak",
      },
    } as SsoConnectionCommand,
    facts: [
      {
        type: CONNECTION_RENAMED_EVENT_TYPE,
        data: { connectionId: CONNECTION, name: "ACME Keycloak", actor: ACTOR },
      } as SsoConnectionFactInput,
    ],
  };
}

describe("given an SSO connection ledger in a process that holds no event log", () => {
  describe("when a command states facts", () => {
    /** @scenario "The SSO connection ledger commits without an event log" */
    it("stages the command on the pipeline's own sender and answers the events", async () => {
      const eventing = new RecordingEventing(true);
      const ledger = SsoConnectionLedgerStore.forPipeline({
        projectionStore: new ConvergedProjection(true),
        commands: eventing,
      });
      const { command, facts } = renameConnection();

      const events = await ledger.commit({ command, facts });

      expect(eventing.asked).toEqual([
        { pipeline: "sso-connections", command: "renameConnection" },
      ]);
      expect(eventing.staged).toEqual([command.data]);
      expect(events.map((event) => event.type)).toEqual([CONNECTION_RENAMED_EVENT_TYPE]);
      expect(events[0]).toMatchObject({ aggregateId: CONNECTION, tenantId: ORGANIZATION });
    });
  });

  describe("when the guard stated nothing", () => {
    it("stages nothing", async () => {
      const eventing = new RecordingEventing(true);
      const ledger = SsoConnectionLedgerStore.forPipeline({
        projectionStore: new ConvergedProjection(true),
        commands: eventing,
      });

      const events = await ledger.commit({ command: renameConnection().command, facts: [] });

      expect(events).toEqual([]);
      expect(eventing.staged).toEqual([]);
    });
  });

  describe("when the projection has not caught up inside the window", () => {
    it("answers the events anyway, because the command is queued", async () => {
      const projection = new ConvergedProjection(false);
      const eventing = new RecordingEventing(true);
      const ledger = SsoConnectionLedgerStore.create({
        projectionStore: projection,
        stagedSender: async (command) => {
          const resolved = await eventing.resolvePipelineCommand({
            pipeline: "sso-connections",
            command,
          });
          return resolved.kind === "registered" ? resolved.sender : null;
        },
        convergence: { timeoutMs: 5, pollMs: 1 },
      });
      const { command, facts } = renameConnection();

      const events = await ledger.commit({ command, facts });

      expect(events).toHaveLength(1);
      expect(eventing.staged).toEqual([command.data]);
      expect(projection.reads.length).toBeGreaterThan(0);
    });
  });
});

describe("given a process that registered no SSO connection pipeline", () => {
  describe("when a command states facts", () => {
    /** @scenario "An SSO connection command nothing can carry is refused by name" */
    it("refuses naming the missing sender and does not wait on the projection", async () => {
      const projection = new ConvergedProjection(false);
      const get = vi.spyOn(projection, "get");
      const eventing = new RecordingEventing(false);
      const ledger = SsoConnectionLedgerStore.forPipeline({
        projectionStore: projection,
        commands: eventing,
      });
      const { command, facts } = renameConnection();

      await expect(ledger.commit({ command, facts })).rejects.toThrow(
        /the pipeline exposes no "renameConnection" sender/,
      );

      expect(eventing.staged).toEqual([]);
      expect(get).not.toHaveBeenCalled();
    });
  });
});
