/**
 * Per-process composition of local control: repositories, presence, the workspace channel,
 * dispatcher, wait service, control requests and the skip policy (ADR-129). The tiers are
 * chosen by the process's own composition root (ADR-093/ADR-128); this only assembles them.
 */

import type { LangyLocalWorkspaceChannel } from "../../../channels/langy-local-workspace.channel.ts";
import type { LangyLocalCallRepository } from "../../../repositories/langy-local-call.repository.ts";
import type { LangyLocalControlRequestRepository } from "../../../repositories/langy-local-control-request.repository.ts";
import type { LangyLocalPresenceRepository } from "../../../repositories/langy-local-presence.repository.ts";
import type { LangyLocalUserWaitRepository } from "../../../repositories/langy-local-user-wait.repository.ts";
import type { LocalCallBuffer } from "../../../rules/langy-local-call-record.rules.ts";
import type {
  StoredUserWait,
  UserWaitBuffer,
  UserWaitEvents,
} from "../../../rules/langy-local-user-wait-record.rules.ts";
import { LocalCallDispatcherService } from "./langy-local-call-dispatcher.service.ts";
import {
  ControlRequestService,
  type ControlRequestKeyMinter,
  type ControlRequestProjects,
} from "./langy-local-control-request.service.ts";
import { LocalSkipPolicyService } from "./langy-local-skip-policy.service.ts";
import { UserWaitService } from "./langy-local-user-wait.service.ts";

/** One process's local-control composition (ADR-129). */
export interface LocalControlRuntime {
  workspace: LangyLocalWorkspaceChannel;
  presence: LangyLocalPresenceRepository;
  dispatcher: LocalCallDispatcherService;
  waits: UserWaitService;
  requests: ControlRequestService;
  skipPolicy: LocalSkipPolicyService;
}

/** The local-control state, one repository per record family. */
export type LocalControlRepositories = {
  calls: LangyLocalCallRepository;
  userWaits: LangyLocalUserWaitRepository;
  controlRequests: LangyLocalControlRequestRepository;
  presence: LangyLocalPresenceRepository;
};

type Timing = { offlineWaitMs?: number; pollIntervalMs?: number; now?: () => number };

/** Told every answered card, so a confirmation card's click is recorded where it is spent. */
type AnswerListener = { onAnswered?: (wait: StoredUserWait) => Promise<void> };

/** One process's local control, built over its repositories and workspace channel. */
export class LangyLocalControlRuntimeService implements LocalControlRuntime {
  /**
   * Tests build two over one set of memory repositories and one memory channel to play two
   * pods, exactly as the connected agents tests do.
   */
  static create(
    input: LocalControlRepositories & {
      workspace: LangyLocalWorkspaceChannel;
      projects: ControlRequestProjects;
      mintSessionKey: ControlRequestKeyMinter;
      events: UserWaitEvents;
      buffer: UserWaitBuffer & LocalCallBuffer;
    } & Timing &
      AnswerListener,
  ): LangyLocalControlRuntimeService {
    return new LangyLocalControlRuntimeService(input);
  }

  readonly workspace: LangyLocalWorkspaceChannel;
  readonly presence: LangyLocalPresenceRepository;
  readonly dispatcher: LocalCallDispatcherService;
  readonly waits: UserWaitService;
  readonly requests: ControlRequestService;
  readonly skipPolicy: LocalSkipPolicyService;

  private constructor({
    calls,
    userWaits,
    controlRequests,
    presence,
    workspace,
    projects,
    mintSessionKey,
    events,
    buffer,
    onAnswered,
    ...timing
  }: LocalControlRepositories & {
    workspace: LangyLocalWorkspaceChannel;
    projects: ControlRequestProjects;
    mintSessionKey: ControlRequestKeyMinter;
    events: UserWaitEvents;
    buffer: UserWaitBuffer & LocalCallBuffer;
  } & Timing &
    AnswerListener) {
    const { offlineWaitMs, pollIntervalMs, now } = timing;
    const clock = now ? { now } : {};
    const polling = pollIntervalMs !== undefined ? { pollIntervalMs } : {};
    this.workspace = workspace;
    this.presence = presence;
    this.dispatcher = LocalCallDispatcherService.create({
      calls,
      workspace,
      presence,
      buffer,
      ...clock,
      ...(offlineWaitMs !== undefined ? { offlineWaitMs } : {}),
      ...polling,
    });
    const dispatcher = this.dispatcher;
    this.waits = UserWaitService.create({
      waits: userWaits,
      events,
      buffer,
      sendPermission: (args) => dispatcher.sendPermission(args),
      ...(onAnswered ? { onAnswered } : {}),
      ...clock,
      ...polling,
    });
    this.requests = ControlRequestService.create({
      requests: controlRequests,
      projects,
      mintSessionKey,
      ...clock,
    });
    this.skipPolicy = LocalSkipPolicyService.create({ presence, workspace });
  }

  /**
   * Ends every local call and every card of one turn, for Stop: the command line is told to
   * cancel each call and each waiting card ends as cancelled. Idempotent, as the worker's own
   * cancel route reaches the same records.
   */
  async cancelTurn({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    for (const call of await this.dispatcher.listPendingForTurn({ conversationId, turnId })) {
      await this.dispatcher.cancel({ callId: call.callId });
    }
    await this.waits.cancelTurn({ conversationId, turnId });
  }
}
