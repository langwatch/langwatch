import type { StateProjectionStore, StoredProjection } from "@langwatch/eventing";

import type { ConnectionTeardown } from "../eventing/connection-teardown.process.ts";
import type { IdentityFoldState } from "../eventing/identity-state.projection.ts";
import type { JoinRequestLifecycle } from "../eventing/join-request-lifecycle.process.ts";
import type { JoinRequestFoldState } from "../eventing/join-request-state.projection.ts";
import type { MfaFoldState } from "../eventing/mfa-enrollment-state.projection.ts";
import type { ScimSyncFoldState } from "../eventing/scim-sync-state.projection.ts";
import type { SsoConnectionFoldState } from "../eventing/sso-connection-state.projection.ts";
import type { SsoDomainProofNotifications } from "../eventing/sso-domain-proof-notification.process.ts";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import type { IdentityReservationRepository } from "../repositories/identity-reservations.repository.ts";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository.ts";
import type { JoinRequestReadRepository } from "../repositories/join-request.repository.ts";
import type { MfaEnrollmentRepository } from "../repositories/mfa-enrollment.repository.ts";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository.ts";
import type { SsoConnectionRegistrationRepository } from "../repositories/sso-connection-registration.repository.ts";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../repositories/sso-connection.repository.ts";
import { CryptoIdentifierIdentityAdapter } from "./crypto-identifier-identity.service.ts";
/**
 * The four identity pipelines as a PRODUCER registers them. One definition, two registrations.
 */
import { IdentityGuardsService } from "./identity-guards.service.ts";
import {
  IdentityPipelineDefinitionAdapter,
  type IdentityPipeline,
} from "./identity-pipeline-definition.service.ts";
import { JoinRequestGuardsService } from "./join-request-guards.service.ts";
import {
  JoinRequestPipelineDefinitionAdapter,
  type JoinRequestPipeline,
} from "./join-request-pipeline-definition.service.ts";
import { MfaGuardsService } from "./mfa-guards.service.ts";
import { ScimSyncGuardsService } from "./scim-sync-guards.service.ts";
import {
  ScimSyncPipelineDefinitionAdapter,
  type ScimSyncPipeline,
} from "./scim-sync-pipeline-definition.service.ts";
import { SsoConnectionGuardsService } from "./sso-connection-guards.service.ts";
import { SsoConnectionPipelineDefinitionAdapter } from "./sso-connection-pipeline-definition.service.ts";

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

/** The expiry and every join-request notice, refused: this process sends no mail here. */
class ProducerOnlyJoinRequestLifecycle implements JoinRequestLifecycle {
  constructor(private readonly processName: string) {}

  expireRequest(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "join-requests",
        capability: "expire a join request",
      }),
    );
  }

  prepareNotification(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "join-requests",
        capability: "tell people about a join request",
      }),
    );
  }
}

/** The domain-proof notices, refused: this process sends no mail here. */
class ProducerOnlySsoDomainProofNotifications implements SsoDomainProofNotifications {
  constructor(private readonly processName: string) {}

  proofWavering(): Promise<void> {
    return this.refuse("tell administrators a domain's proof went missing");
  }

  proofLapsed(): Promise<void> {
    return this.refuse("tell administrators a domain's proof lapsed");
  }

  private refuse(capability: string): Promise<void> {
    return Promise.reject(
      producerOnly({ processName: this.processName, pipeline: "sso-connections", capability }),
    );
  }
}

/** The teardown completion, refused: only the draining process advances it. */
class ProducerOnlyConnectionTeardown implements ConnectionTeardown {
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
      identityGuards: IdentityGuardsService.create({
        heads: producerOnlyReads<IdentityHeadsRepository>({
          processName: this.processName,
          pipeline,
          name: "identity heads",
        }),
        users: producerOnlyReads<IdentityUsersRepository>({
          processName: this.processName,
          pipeline,
          name: "identity users",
        }),
        reservations: producerOnlyReads<IdentityReservationRepository>({
          processName: this.processName,
          pipeline,
          name: "identifier reservations",
        }),
        identifiers: CryptoIdentifierIdentityAdapter.create(),
      }),
      mfaProjectionStore: new ProducerOnlyStateProjectionStore<MfaFoldState>(
        this.processName,
        pipeline,
        "two-step enrollment",
      ),
      mfaGuards: MfaGuardsService.create(
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
      joinRequestGuards: JoinRequestGuardsService.create({
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
      connectionGuards: SsoConnectionGuardsService.create({
        connections: producerOnlyReads<SsoConnectionReadRepository>({
          processName: this.processName,
          pipeline,
          name: "connections",
        }),
        registrationSlots: producerOnlyReads<SsoConnectionRegistrationRepository>({
          processName: this.processName,
          pipeline,
          name: "registration slots",
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
      proofNotifications: new ProducerOnlySsoDomainProofNotifications(this.processName),
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
      scimSyncGuards: ScimSyncGuardsService.create({
        syncs: producerOnlyReads<ScimSyncReadRepository>({
          processName: this.processName,
          pipeline,
          name: "directory syncs",
        }),
      }),
    });
  }
}
