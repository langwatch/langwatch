import type { IdentityFoldState } from "../eventing/identity-state.projection.ts";
import type { JoinRequestFoldState } from "../eventing/join-request-state.projection.ts";
import {
  defineJoinRequestPipeline,
  type JoinRequestPipeline,
} from "../eventing/join-request.pipeline.ts";
import type { MfaFoldState } from "../eventing/mfa-enrollment-state.projection.ts";
import {
  ProducerOnlyConnectionTeardown,
  ProducerOnlyJoinRequestLifecycle,
  ProducerOnlySsoConnectionDirectoryMove,
  ProducerOnlySsoDomainProofNotifications,
  ProducerOnlyStateProjectionStore,
  producerOnlyReads,
} from "../eventing/producer-only.store.ts";
import type { ScimSyncFoldState } from "../eventing/scim-sync-state.projection.ts";
import { defineScimSyncPipeline, type ScimSyncPipeline } from "../eventing/scim-sync.pipeline.ts";
import type { SsoConnectionFoldState } from "../eventing/sso-connection-state.projection.ts";
import {
  defineSsoConnectionPipeline,
  type SsoConnectionPipeline,
} from "../eventing/sso-connection.pipeline.ts";
import {
  defineIdentityPipeline,
  type IdentityPipeline,
} from "../eventing/user-identity.pipeline.ts";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import type { IdentityHistoryRepository } from "../repositories/identity-history.repository.ts";
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
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { JoinRequestGuardsService } from "../services/join-request-guards.service.ts";
import { LinkProposalGuardsService } from "../services/link-proposal-guards.service.ts";
import { MfaGuardsService } from "../services/mfa-guards.service.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";

/**
 * The four identity pipelines as a process that only SENDS commands on them sees them: every read,
 * projection and process-manager seam is a stand-in that refuses by name.
 */
export class IdentityProducerPipelines {
  static create({ processName }: { processName: string }): IdentityProducerPipelines {
    return new IdentityProducerPipelines(processName);
  }

  private constructor(private readonly processName: string) {}

  /** The identity pipeline for a process that only sends commands on it. */
  identityPipeline(): IdentityPipeline {
    const pipeline = "identity";
    return defineIdentityPipeline({
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
        identifiers: CryptoIdentifierIdentityService.create(),
      }),
      linkProposalGuards: LinkProposalGuardsService.create({
        proposals: producerOnlyReads<IdentityHistoryRepository>({
          processName: this.processName,
          pipeline,
          name: "identity link proposals",
        }),
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
    return defineJoinRequestPipeline({
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
  ssoConnectionPipeline(): SsoConnectionPipeline {
    const pipeline = "sso-connections";
    return defineSsoConnectionPipeline({
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
      directoryMove: new ProducerOnlySsoConnectionDirectoryMove(this.processName),
    });
  }

  /**
   * The directory-sync pipeline for a process that only sends commands on it.
   */
  scimSyncPipeline(): ScimSyncPipeline {
    const pipeline = "scim-sync";
    return defineScimSyncPipeline({
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
