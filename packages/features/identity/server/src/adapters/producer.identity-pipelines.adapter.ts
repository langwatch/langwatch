/**
 * The four identity pipelines as a PRODUCER registers them.
 *
 * One definition, two registrations. The consumer — the worker — supplies the
 * real Postgres heads, the guards that read them, the mail the join lifecycle
 * sends and the teardown the connection grace completes, and drains every
 * routing key each definition declares. A producer registers the SAME
 * definition only to obtain its command dispatchers: the writes a person's
 * action turns into, off a tRPC call, and nothing else. It starts no consumer
 * loop, folds nothing and runs no process manager.
 *
 * Every dependency these definitions take is consumer-side, and a producer has
 * none of them. That is what this module supplies — stand-ins that exist so a
 * definition can be CONSTRUCTED and refuse by name if one is ever CALLED.
 * Refusing rather than no-op'ing is the whole point: a silently-succeeding fold
 * store in a process that was never meant to fold would report a projection as
 * written when nothing was, and the row would simply never appear.
 *
 * TWO OF THE FOUR DECLARE A PROCESS MANAGER AND RUN IT THERE. `join-requests`
 * mounts the reminder-and-expiry lifecycle and `sso-connections` mounts the
 * teardown grace, and the runtime used to refuse to register any pipeline
 * declaring one without a durable `ProcessStore` — which made every command on
 * both unsendable from the tier a person's action actually arrives at. A
 * producer-only runtime registers the definition whole and declines the manager
 * by name instead (`EventSourcingOptions.processManagerMode`), so the inbox,
 * outbox and wakes stay the consumer's alone. `identity` and `scim-sync` mount
 * none and needed only to be registered at all — a directory's push is retried
 * by the DIRECTORY, so `scim-sync` has no manager to decline.
 *
 * Forking a definition instead — declaring only the commands a producer sends —
 * is the thing this avoids. The routing triple every job carries is derived
 * from the pipeline and command names, so two descriptions of one event stream
 * drift into jobs the worker cannot route, and the queue rejects an unroutable
 * job for redelivery rather than dropping it.
 */
import { IdentityGuards } from "../guards";
import { JoinRequestGuards } from "../join-request-guards";
import { MfaGuards } from "../mfa-guards";
import { ScimSyncGuards } from "../scim-sync-guards";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import type { IdentityReservationRepository } from "../identity-reservations.repository";
import type { IdentityUsersRepository } from "../identity-users.repository";
import type { JoinRequestReadRepository } from "../join-request.repository";
import type { MfaEnrollmentRepository } from "../mfa-enrollment.repository";
import type { ScimSyncReadRepository } from "../scim-sync.repository";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../sso-connection.repository";
import type { StateProjectionStore, StoredProjection } from "@langwatch/eventing";
import {
  createIdentityPipeline,
  type IdentityPipeline,
} from "./identity-pipeline-definition.adapter";
import type { IdentityFoldState } from "../projections/identity-state.projection";
import type { MfaFoldState } from "../projections/mfa-enrollment-state.projection";
import {
  createJoinRequestPipeline,
  type JoinRequestPipeline,
} from "./join-request-pipeline-definition.adapter";
import type { JoinRequestLifecyclePort } from "../processes/join-request-lifecycle.process";
import type { JoinRequestFoldState } from "../projections/join-request-state.projection";
import {
  createScimSyncPipeline,
  type ScimSyncPipeline,
} from "./scim-sync-pipeline-definition.adapter";
import type { ScimSyncFoldState } from "../projections/scim-sync-state.projection";
import { createSsoConnectionPipeline } from "./sso-connection-pipeline-definition.adapter";
import type { ConnectionTeardownPort } from "../processes/connection-teardown.process";
import type { SsoConnectionFoldState } from "../projections/sso-connection-state.projection";

/** Why every stand-in below refuses, in the process's own words. */
function producerOnly(input: { processName: string; pipeline: string; capability: string }): Error {
  return new Error(
    `${input.processName} registered the ${input.pipeline} pipeline as a producer only, so it cannot ${input.capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A projection head that cannot be read or written, because nothing folds here. */
class ProducerOnlyStateProjectionStore<TState> implements StateProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly pipeline: string,
    private readonly name: string,
  ) {}

  tryLoad(): Promise<StoredProjection<TState> | null> {
    return Promise.reject(this.refuse(`read the ${this.name} projection`));
  }

  store(): Promise<void> {
    return Promise.reject(this.refuse(`write the ${this.name} projection`));
  }

  private refuse(capability: string): Error {
    return producerOnly({
      processName: this.processName,
      pipeline: this.pipeline,
      capability,
    });
  }
}

/**
 * A guard's repository, refusing every read by name.
 *
 * A proxy rather than nine hand-written doubles: these repositories carry
 * dozens of reads between them, a producer reaches NONE of them — the guards
 * run inside the command handler, which is the consumer's work — and a
 * hand-written double would be a second description of nine interfaces that
 * has to be edited every time one of them gains a method. What matters is that
 * a call says which process reached it, and that is what this answers.
 */
function producerOnlyReads<TRepository extends object>(input: {
  processName: string;
  pipeline: string;
  name: string;
}): TRepository {
  return new Proxy({} as TRepository, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      return () =>
        Promise.reject(
          producerOnly({
            processName: input.processName,
            pipeline: input.pipeline,
            capability: `read ${input.name}.${property}`,
          }),
        );
    },
  });
}

/** The reminder and the lapse notice, refused: this process sends no mail here. */
class ProducerOnlyJoinRequestLifecycle implements JoinRequestLifecyclePort {
  constructor(private readonly processName: string) {}

  remindAdmins(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "join-requests",
        capability: "remind an organization's admins about a waiting request",
      }),
    );
  }

  expireRequest(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "join-requests",
        capability: "expire a join request",
      }),
    );
  }
}

/** The teardown completion, refused: only the draining process advances it. */
class ProducerOnlyConnectionTeardown implements ConnectionTeardownPort {
  constructor(private readonly processName: string) {}

  completeTeardown(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "sso-connections",
        capability: "complete a connection's teardown",
      }),
    );
  }
}

/**
 * The identity pipeline for a process that only sends commands on it.
 *
 * `processName` names the refusal, so a stand-in reached by accident says which
 * process reached it rather than reporting an anonymous failure.
 */
export function createIdentityProducerPipeline(input: { processName: string }): IdentityPipeline {
  const { processName } = input;
  const pipeline = "identity";
  return createIdentityPipeline({
    identityProjectionStore: new ProducerOnlyStateProjectionStore<IdentityFoldState>(
      processName,
      pipeline,
      "identifier",
    ),
    identityGuards: new IdentityGuards(
      producerOnlyReads<IdentityHeadsRepository>({
        processName,
        pipeline,
        name: "identity heads",
      }),
      producerOnlyReads<IdentityUsersRepository>({
        processName,
        pipeline,
        name: "identity users",
      }),
      producerOnlyReads<IdentityReservationRepository>({
        processName,
        pipeline,
        name: "identifier reservations",
      }),
    ),
    mfaProjectionStore: new ProducerOnlyStateProjectionStore<MfaFoldState>(
      processName,
      pipeline,
      "two-step enrollment",
    ),
    mfaGuards: new MfaGuards(
      producerOnlyReads<MfaEnrollmentRepository>({
        processName,
        pipeline,
        name: "two-step enrollments",
      }),
    ),
  });
}

/** The join-request pipeline for a process that only sends commands on it. */
export function createJoinRequestProducerPipeline(input: {
  processName: string;
}): JoinRequestPipeline {
  const { processName } = input;
  const pipeline = "join-requests";
  return createJoinRequestPipeline({
    joinRequestProjectionStore: new ProducerOnlyStateProjectionStore<JoinRequestFoldState>(
      processName,
      pipeline,
      "join request",
    ),
    joinRequestGuards: new JoinRequestGuards({
      requests: producerOnlyReads<JoinRequestReadRepository>({
        processName,
        pipeline,
        name: "join requests",
      }),
    }),
    lifecycle: new ProducerOnlyJoinRequestLifecycle(processName),
  });
}

/** The connection pipeline for a process that only sends commands on it. */
export function createSsoConnectionProducerPipeline(input: {
  processName: string;
}): ReturnType<typeof createSsoConnectionPipeline> {
  const { processName } = input;
  const pipeline = "sso-connections";
  return createSsoConnectionPipeline({
    connectionProjectionStore: new ProducerOnlyStateProjectionStore<SsoConnectionFoldState>(
      processName,
      pipeline,
      "single sign-on connection",
    ),
    connectionGuards: new SsoConnectionGuards({
      connections: producerOnlyReads<SsoConnectionReadRepository>({
        processName,
        pipeline,
        name: "connections",
      }),
      breakGlass: producerOnlyReads<SsoBreakGlassBindingRepository>({
        processName,
        pipeline,
        name: "break-glass bindings",
      }),
      stranding: producerOnlyReads<SsoConnectionStrandingRepository>({
        processName,
        pipeline,
        name: "stranding checks",
      }),
      platformOperators: producerOnlyReads<SsoPlatformOperatorRepository>({
        processName,
        pipeline,
        name: "platform operators",
      }),
    }),
    teardown: new ProducerOnlyConnectionTeardown(processName),
  });
}

/**
 * The directory-sync pipeline for a process that only sends commands on it.
 *
 * NO PROCESS MANAGER to decline, unlike its two neighbours: `scim-sync`
 * declares none on purpose — a push is the DIRECTORY's to retry, so there is
 * no inbox, outbox or wake for a producer-only runtime to keep off. What a
 * producer needs from this definition is the same five command dispatchers the
 * worker's registration carries, so an Enterprise directory push has a sender
 * to stage its history through.
 */
export function createScimSyncProducerPipeline(input: { processName: string }): ScimSyncPipeline {
  const { processName } = input;
  const pipeline = "scim-sync";
  return createScimSyncPipeline({
    scimSyncProjectionStore: new ProducerOnlyStateProjectionStore<ScimSyncFoldState>(
      processName,
      pipeline,
      "directory sync",
    ),
    scimSyncGuards: new ScimSyncGuards({
      syncs: producerOnlyReads<ScimSyncReadRepository>({
        processName,
        pipeline,
        name: "directory syncs",
      }),
    }),
  });
}
