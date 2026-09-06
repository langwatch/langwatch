/**
 * The per-process composition of local control: one state store, presence, the
 * call dispatcher, the wait service and the control requests (ADR-129).
 *
 * The store is Redis when the process has one and process memory otherwise,
 * the same rule connected agents follow (ADR-093, ADR-128). Nothing here is a
 * module singleton: the process composes one runtime and hands it to the
 * transports, so a process that never serves a local call composes none.
 */

import { type AgentStateStorePort, ConnectedAgentStateAdapter } from "@langwatch/agent-server";

import {
  type LocalCallBuffer,
  LocalCallDispatcher,
} from "../services/langy-local-call-dispatcher.service";
import {
  ControlRequestService,
  type ControlRequestKeyMinter,
  type ControlRequestProjects,
} from "../services/langy-local-control-request.service";
import { LocalWorkspacePresence } from "./redis.langy-local-presence.adapter";
import {
  type UserWaitBuffer,
  type UserWaitEvents,
  UserWaitService,
} from "../services/langy-local-user-wait.service";

export interface LocalControlRuntime {
  store: AgentStateStorePort;
  presence: LocalWorkspacePresence;
  dispatcher: LocalCallDispatcher;
  waits: UserWaitService;
  requests: ControlRequestService;
}

/** The Redis a local-control runtime shares with connected agents, when there is one. */
export type LocalControlRedis = Parameters<typeof ConnectedAgentStateAdapter.redis>[0];

/**
 * Builds a runtime around one store. Tests build two over one memory store to
 * play two pods, exactly as the connected agents tests do.
 */
export function createLocalControlRuntime({
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
  const presence = new LocalWorkspacePresence({
    store,
    ...(now ? { now } : {}),
  });
  const dispatcher = new LocalCallDispatcher({
    store,
    presence,
    buffer,
    ...(now ? { now } : {}),
    ...(offlineWaitMs !== undefined ? { offlineWaitMs } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
  });
  const waits = new UserWaitService({
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

/** The store a process composes its runtime over: shared when it has Redis. */
export function createLocalControlStore(redis: LocalControlRedis | null): AgentStateStorePort {
  return redis ? ConnectedAgentStateAdapter.redis(redis) : ConnectedAgentStateAdapter.memory();
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
export async function cancelLocalWorkForTurn({
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
export function nullLocalControlBuffer(): UserWaitBuffer & LocalCallBuffer {
  return {
    appendLocalPermission: async () => undefined,
    appendQuestion: async () => undefined,
    appendStatus: async () => undefined,
    heartbeat: async () => undefined,
  };
}
