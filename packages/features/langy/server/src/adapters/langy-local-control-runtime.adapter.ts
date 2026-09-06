/**
 * The per-process composition of local control: one state store, presence, the
 * call dispatcher, the wait service and the control requests (ADR-129).
 *
 * The store itself (Redis when the process has one, process memory otherwise,
 * the same rule connected agents follow per ADR-093/ADR-128) is composed by the
 * process's own composition root, which is where a concrete connected-agent
 * store is allowed to be chosen; this module only assembles the runtime around
 * whatever store it is handed. Nothing here is a module singleton: the process
 * composes one runtime and hands it to the transports, so a process that never
 * serves a local call composes none.
 */

import type { AgentStateStorePort } from "@langwatch/agent-contract";

import {
  type LocalCallBuffer,
  LocalCallDispatcherService,
} from "../services/langy-local-call-dispatcher.service";
import {
  ControlRequestService,
  type ControlRequestKeyMinter,
  type ControlRequestProjects,
} from "../services/langy-local-control-request.service";
import { LangyLocalPresenceAdapter } from "./redis.langy-local-presence.adapter";
import {
  type UserWaitBuffer,
  type UserWaitEvents,
  UserWaitService,
} from "../services/langy-local-user-wait.service";

export interface LocalControlRuntime {
  store: AgentStateStorePort;
  presence: LangyLocalPresenceAdapter;
  dispatcher: LocalCallDispatcherService;
  waits: UserWaitService;
  requests: ControlRequestService;
}

export class LangyLocalControlRuntimeAdapter {
  private constructor() {}

  /**
   * Builds a runtime around one store. Tests build two over one memory store to
   * play two pods, exactly as the connected agents tests do.
   */
  static create({
    store,
    projects,
    mintSessionKey,
    events,
    buffer,
    offlineWaitMs,
    pollIntervalMs,
    now,
  }: {
    store: AgentStateStorePort;
    projects: ControlRequestProjects;
    mintSessionKey: ControlRequestKeyMinter;
    events: UserWaitEvents;
    buffer: UserWaitBuffer & LocalCallBuffer;
    offlineWaitMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
  }): LocalControlRuntime {
    const presence = LangyLocalPresenceAdapter.create({
      store,
      ...(now ? { now } : {}),
    });
    const dispatcher = LocalCallDispatcherService.create({
      store,
      presence,
      buffer,
      ...(now ? { now } : {}),
      ...(offlineWaitMs !== undefined ? { offlineWaitMs } : {}),
      ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    });
    const waits = UserWaitService.create({
      store,
      events,
      buffer,
      sendPermission: (args) => dispatcher.sendPermission(args),
      ...(now ? { now } : {}),
      ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    });
    const requests = ControlRequestService.create({
      store,
      projects,
      mintSessionKey,
      ...(now ? { now } : {}),
    });
    return { store, presence, dispatcher, waits, requests };
  }

  /**
   * Ends every local call and every card of one turn (ADR-078 Stop).
   *
   * A stopped turn leaves nothing running on the developer's machine and no card
   * waiting for an answer nobody will use: the command line receives a `cancel`
   * frame for each call, and each pending wait ends as cancelled. Both halves are
   * idempotent, because the turn's Stop and the worker's own cancel route both
   * reach here.
   */
  static async cancelWorkForTurn({
    runtime,
    conversationId,
    turnId,
  }: {
    runtime: LocalControlRuntime;
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    for (const call of await runtime.dispatcher.listPendingForTurn({
      conversationId,
      turnId,
    })) {
      await runtime.dispatcher.cancel({ callId: call.callId });
    }
    await runtime.waits.cancelTurn({ conversationId, turnId });
  }

  /** Stands in for the live edge on a process with no Redis: the record still lands. */
  static nullBuffer(): UserWaitBuffer & LocalCallBuffer {
    return {
      appendLocalPermission: async () => undefined,
      appendQuestion: async () => undefined,
      appendStatus: async () => undefined,
      heartbeat: async () => undefined,
    };
  }
}
