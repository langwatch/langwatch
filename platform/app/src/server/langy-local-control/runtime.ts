/**
 * The per-process composition of local control: one state store, presence, the
 * call dispatcher, the wait service and the control requests (ADR-129).
 *
 * The store is Redis when the App has one and process memory otherwise, the
 * same rule connected agents follow (ADR-093, ADR-128): Redis is read off the
 * App, never from a module singleton, and the composition is lazy so a process
 * that never serves a local call never subscribes to anything.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { tryGetApp } from "~/server/app-layer/app";
import { createLangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import {
  type AgentStateStore,
  createMemoryStateStore,
  createRedisStateStore,
} from "~/server/connected-agents/state-store";
import { prisma as defaultPrisma } from "~/server/db";
import { LocalCallDispatcher } from "./call.dispatcher";
import { LocalControlLongPoll } from "./control.long-poll";
import { ControlRequestService } from "./control-request.service";
import { LocalWorkspacePresence } from "./presence";
import { LocalControlSessionCore } from "./session.core";
import {
  type UserWaitBuffer,
  type UserWaitEvents,
  UserWaitService,
} from "./user-wait.service";

export interface LocalControlRuntime {
  store: AgentStateStore;
  presence: LocalWorkspacePresence;
  dispatcher: LocalCallDispatcher;
  waits: UserWaitService;
  requests: ControlRequestService;
}

/**
 * Builds a runtime around one store. Tests build two over one memory store to
 * play two pods, exactly as the connected agents tests do.
 */
export function createLocalControlRuntime({
  store,
  prisma = defaultPrisma,
  events,
  buffer,
  offlineWaitMs,
  pollIntervalMs,
  now,
}: {
  store: AgentStateStore;
  prisma?: PrismaClient;
  events: UserWaitEvents;
  buffer: UserWaitBuffer;
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
  const requests = new ControlRequestService({
    store,
    prisma,
    ...(now ? { now } : {}),
  });
  return { store, presence, dispatcher, waits, requests };
}

let processRuntime: LocalControlRuntime | null = null;

/** The runtime of this process, built on first use. */
export function getLocalControlRuntime(): LocalControlRuntime {
  if (processRuntime) return processRuntime;
  const app = tryGetApp();
  const redis = app?.redis ?? null;
  const store = redis ? createRedisStateStore(redis) : createMemoryStateStore();
  const buffer = redis ? createLangyTokenBuffer({ redis }) : nullBuffer();
  processRuntime = createLocalControlRuntime({
    store,
    events: langyWaitEvents(),
    buffer,
  });
  return processRuntime;
}

let processCore: LocalControlSessionCore | null = null;
let processLongPoll: LocalControlLongPoll | null = null;

/** The session core of this process, over the process runtime. */
export function getLocalControlSessionCore(): LocalControlSessionCore {
  if (processCore) return processCore;
  const runtime = getLocalControlRuntime();
  processCore = new LocalControlSessionCore({
    prisma: defaultPrisma,
    store: runtime.store,
    presence: runtime.presence,
    dispatcher: runtime.dispatcher,
    waits: runtime.waits,
    requests: runtime.requests,
  });
  return processCore;
}

/** The long-poll transport of this process, over the same session core. */
export function getLocalControlLongPoll(): LocalControlLongPoll {
  if (processLongPoll) return processLongPoll;
  processLongPoll = new LocalControlLongPoll({
    core: getLocalControlSessionCore(),
  });
  return processLongPoll;
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
  conversationId,
  turnId,
}: {
  conversationId: string;
  turnId: string;
}): Promise<void> {
  const runtime = getLocalControlRuntime();
  for (const call of await runtime.dispatcher.listPendingForTurn({
    conversationId,
    turnId,
  })) {
    await runtime.dispatcher.cancel({ callId: call.callId });
  }
  await runtime.waits.cancelTurn({ conversationId, turnId });
}

/** Closes the process runtime; the next read builds a fresh one. */
export async function closeLocalControlRuntime(): Promise<void> {
  const runtime = processRuntime;
  const longPoll = processLongPoll;
  processRuntime = null;
  processCore = null;
  processLongPoll = null;
  await longPoll?.close();
  if (!runtime) return;
  await runtime.store.close();
}

/**
 * The two durable dispatches the wait service makes, resolved from the App at
 * call time. A deployment with event sourcing off wires them to no-ops there,
 * so this reads whatever the App holds rather than deciding for it.
 */
function langyWaitEvents(): UserWaitEvents {
  return {
    async startUserWait(data) {
      await tryGetApp()?.commands.langy.startUserWait(data);
    },
    async endUserWait(data) {
      await tryGetApp()?.commands.langy.endUserWait(data);
    },
  };
}

/** Stands in for the live edge on a process with no Redis: the record still lands. */
function nullBuffer(): UserWaitBuffer {
  return {
    appendLocalPermission: async () => undefined,
    appendQuestion: async () => undefined,
    appendStatus: async () => undefined,
  };
}
