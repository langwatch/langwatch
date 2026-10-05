/**
 * Per-process composition of local control: store, presence, dispatcher, wait service and
 * control requests (ADR-129). The store is chosen by the process's own composition root
 * (ADR-093/ADR-128); this only assembles around it.
 */

import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import type { LangyLocalPresenceRepository } from "../repositories/langy-local-presence.repository.ts";
import type { LocalCallBuffer } from "../rules/langy-local-call-record.rules.ts";
import type {
  UserWaitBuffer,
  UserWaitEvents,
} from "../rules/langy-local-user-wait-record.rules.ts";
import { LocalCallDispatcherService } from "./langy-local-call-dispatcher.service.ts";
import {
  ControlRequestService,
  type ControlRequestKeyMinter,
  type ControlRequestProjects,
} from "./langy-local-control-request.service.ts";
import { UserWaitService } from "./langy-local-user-wait.service.ts";

/** One process's local-control composition around one session store (ADR-129). */
export interface LocalControlRuntime {
  store: SessionStateStore;
  presence: LangyLocalPresenceRepository;
  dispatcher: LocalCallDispatcherService;
  waits: UserWaitService;
  requests: ControlRequestService;
}

type Timing = { offlineWaitMs?: number; pollIntervalMs?: number; now?: () => number };

/** One process's local control, built around one store and the presence kept in it. */
export class LangyLocalControlRuntimeService implements LocalControlRuntime {
  /**
   * Tests build two over one memory store to play two pods, exactly as the connected agents
   * tests do.
   */
  static create(input: {
    store: SessionStateStore;
    presence: LangyLocalPresenceRepository;
    projects: ControlRequestProjects;
    mintSessionKey: ControlRequestKeyMinter;
    events: UserWaitEvents;
    buffer: UserWaitBuffer & LocalCallBuffer;
    offlineWaitMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
  }): LangyLocalControlRuntimeService {
    return new LangyLocalControlRuntimeService(input);
  }

  readonly store: SessionStateStore;
  readonly presence: LangyLocalPresenceRepository;
  readonly dispatcher: LocalCallDispatcherService;
  readonly waits: UserWaitService;
  readonly requests: ControlRequestService;

  private constructor({
    store,
    presence,
    projects,
    mintSessionKey,
    events,
    buffer,
    ...timing
  }: {
    store: SessionStateStore;
    presence: LangyLocalPresenceRepository;
    projects: ControlRequestProjects;
    mintSessionKey: ControlRequestKeyMinter;
    events: UserWaitEvents;
    buffer: UserWaitBuffer & LocalCallBuffer;
  } & Timing) {
    const { offlineWaitMs, pollIntervalMs, now } = timing;
    const clock = now ? { now } : {};
    const polling = pollIntervalMs !== undefined ? { pollIntervalMs } : {};
    this.store = store;
    this.presence = presence;
    this.dispatcher = LocalCallDispatcherService.create({
      store,
      presence,
      buffer,
      ...clock,
      ...(offlineWaitMs !== undefined ? { offlineWaitMs } : {}),
      ...polling,
    });
    const dispatcher = this.dispatcher;
    this.waits = UserWaitService.create({
      store,
      events,
      buffer,
      sendPermission: (args) => dispatcher.sendPermission(args),
      ...clock,
      ...polling,
    });
    this.requests = ControlRequestService.create({ store, projects, mintSessionKey, ...clock });
  }
}
