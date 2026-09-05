/**
 * The four identity pipelines as a PRODUCER registers them. One definition, two registrations.
 */
import { IdentityGuards } from "../services/identity-guards.service";
import { JoinRequestGuards } from "../services/join-request-guards.service";
import { MfaGuards } from "../services/mfa-guards.service";
import { ScimSyncGuards } from "../services/scim-sync-guards.service";
import { SsoConnectionGuards } from "../services/sso-connection-guards.service";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository";
import type { IdentityReservationRepository } from "../repositories/identity-reservations.repository";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository";
import type { JoinRequestReadRepository } from "../repositories/join-request.repository";
import type { MfaEnrollmentRepository } from "../repositories/mfa-enrollment.repository";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../repositories/sso-connection.repository";
import type { StateProjectionStore, StoredProjection } from "@langwatch/eventing";
import {
  IdentityPipelineDefinitionAdapter,
  type IdentityPipeline,
} from "./identity-pipeline-definition.adapter";
import type { IdentityFoldState } from "../projections/identity-state.projection";
import type { MfaFoldState } from "../projections/mfa-enrollment-state.projection";
import {
  JoinRequestPipelineDefinitionAdapter,
  type JoinRequestPipeline,
} from "./join-request-pipeline-definition.adapter";
import type { JoinRequestLifecyclePort } from "../processes/join-request-lifecycle.process";
import type { JoinRequestFoldState } from "../projections/join-request-state.projection";
import {
  ScimSyncPipelineDefinitionAdapter,
  type ScimSyncPipeline,
} from "./scim-sync-pipeline-definition.adapter";
import type { ScimSyncFoldState } from "../projections/scim-sync-state.projection";
import { SsoConnectionPipelineDefinitionAdapter } from "./sso-connection-pipeline-definition.adapter";
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
 * The four identity pipelines as a process that only SENDS commands on them sees them: every read,
 * projection and process-manager seam is a stand-in that refuses by name.
 */
export class IdentityProducerPipelinesAdapter {
  static create({ processName }: { processName: string }): IdentityProducerPipelinesAdapter {
    return new IdentityProducerPipelinesAdapter(processName);
  }

  private constructor(private readonly processName: string) {}

  /** The identity pipeline for a process that only sends commands on it. */
  identityPipeline(): IdentityPipeline {
    const pipeline = "identity";
    return IdentityPipelineDefinitionAdapter.create({
      identityProjectionStore: new ProducerOnlyStateProjectionStore<IdentityFoldState>(
        this.processName,
        pipeline,
        "identifier",
      ),
      identityGuards: new IdentityGuards(
        producerOnlyReads<IdentityHeadsRepository>({
          processName: this.processName,
          pipeline,
          name: "identity heads",
        }),
        producerOnlyReads<IdentityUsersRepository>({
          processName: this.processName,
          pipeline,
          name: "identity users",
        }),
        producerOnlyReads<IdentityReservationRepository>({
          processName: this.processName,
          pipeline,
          name: "identifier reservations",
        }),
      ),
      mfaProjectionStore: new ProducerOnlyStateProjectionStore<MfaFoldState>(
        this.processName,
        pipeline,
        "two-step enrollment",
      ),
      mfaGuards: new MfaGuards(
        producerOnlyReads<MfaEnrollmentRepository>({
          processName: this.processName,
          pipeline,
          name: "two-step enrollments",
        }),
      ),
    });
  }

  /** The join-request pipeline for a process that only sends commands on it. */
  joinRequestPipeline(): JoinRequestPipeline {
    const pipeline = "join-requests";
    return JoinRequestPipelineDefinitionAdapter.create({
      joinRequestProjectionStore: new ProducerOnlyStateProjectionStore<JoinRequestFoldState>(
        this.processName,
        pipeline,
        "join request",
      ),
      joinRequestGuards: new JoinRequestGuards({
        requests: producerOnlyReads<JoinRequestReadRepository>({
          processName: this.processName,
          pipeline,
          name: "join requests",
        }),
      }),
      lifecycle: new ProducerOnlyJoinRequestLifecycle(this.processName),
    });
  }

  /** The connection pipeline for a process that only sends commands on it. */
  ssoConnectionPipeline(): ReturnType<typeof SsoConnectionPipelineDefinitionAdapter.create> {
    const pipeline = "sso-connections";
    return SsoConnectionPipelineDefinitionAdapter.create({
      connectionProjectionStore: new ProducerOnlyStateProjectionStore<SsoConnectionFoldState>(
        this.processName,
        pipeline,
        "single sign-on connection",
      ),
      connectionGuards: new SsoConnectionGuards({
        connections: producerOnlyReads<SsoConnectionReadRepository>({
          processName: this.processName,
          pipeline,
          name: "connections",
        }),
        breakGlass: producerOnlyReads<SsoBreakGlassBindingRepository>({
          processName: this.processName,
          pipeline,
          name: "break-glass bindings",
        }),
        stranding: producerOnlyReads<SsoConnectionStrandingRepository>({
          processName: this.processName,
          pipeline,
          name: "stranding checks",
        }),
        platformOperators: producerOnlyReads<SsoPlatformOperatorRepository>({
          processName: this.processName,
          pipeline,
          name: "platform operators",
        }),
      }),
      teardown: new ProducerOnlyConnectionTeardown(this.processName),
    });
  }

  /**
   * The directory-sync pipeline for a process that only sends commands on it.
   */
  scimSyncPipeline(): ScimSyncPipeline {
    const pipeline = "scim-sync";
    return ScimSyncPipelineDefinitionAdapter.create({
      scimSyncProjectionStore: new ProducerOnlyStateProjectionStore<ScimSyncFoldState>(
        this.processName,
        pipeline,
        "directory sync",
      ),
      scimSyncGuards: new ScimSyncGuards({
        syncs: producerOnlyReads<ScimSyncReadRepository>({
          processName: this.processName,
          pipeline,
          name: "directory syncs",
        }),
      }),
    });
  }
}
