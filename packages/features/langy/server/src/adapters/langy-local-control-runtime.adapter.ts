/**
 * Per-process composition of local control: store, presence, dispatcher, wait
 * service and control requests (ADR-129). The store is chosen by the process's
 * own composition root (ADR-093/ADR-128); this module only assembles around it.
 */

import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import { LocalCallDispatcherService } from "../services/langy-local-call-dispatcher.service.ts";
import type { LocalCallBuffer } from "../rules/langy-local-call-record.rules.ts";
import {
  ControlRequestService,
  type ControlRequestKeyMinter,
  type ControlRequestProjects,
} from "../services/langy-local-control-request.service.ts";
import { LangyLocalPresenceAdapter } from "./redis.langy-local-presence.adapter.ts";
import { UserWaitService } from "../services/langy-local-user-wait.service.ts";
import type {
  UserWaitBuffer,
  UserWaitEvents,
} from "../rules/langy-local-user-wait-record.rules.ts";

export interface LocalControlRuntime {
  store: SessionStateStore;
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
    store: SessionStateStore;
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
   * Idempotent: the turn's Stop and the worker's cancel route both reach here.
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
      await runtime.dispatcher.tryCancel({ callId: call.callId });
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
