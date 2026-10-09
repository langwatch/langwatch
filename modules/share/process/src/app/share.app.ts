import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  type PinnedTrace,
  type PinTraceInput,
} from "@langwatch/data-retention-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import {
  ShareApi,
  type ShareApi as ShareApiContract,
  type CreateShareInput,
  type ResolveShareInput,
  type RevokeShareInput,
  type ShareLink,
  type ShareProjectScope,
  type ShareResourceInput,
  type SharedPayloadCacheInput,
  type ShareWithProject,
  type TracePinInput,
} from "@langwatch/share-contract";

import {
  buildShareTraceSharingRevocationPipeline,
  type ShareTraceSharingRevocationPipeline,
} from "../eventing/share-trace-sharing-revocation.pipeline.ts";
import { LedgerShareRepository } from "../repositories/ledger/ledger.share.repository.ts";
import type { ShareRepositories } from "../repositories/share.repositories.ts";
import { ShareService } from "../services/share.service.ts";

type ShareSetup = FeatureSetup<typeof ShareModule.dependencies, undefined, ShareRepositories>;

export class ShareModule implements ShareApiContract {
  static readonly contract = ShareApi;
  static readonly dependencies = {
    dataRetention: DataRetentionApi,
    authorization: AuthzApi,
    projects: ProjectApi,
  };

  readonly #shares: ShareService;
  readonly #retention: DataRetentionApi;
  readonly #projects: ProjectApi;

  private constructor(parts: {
    shares: ShareService;
    retention: DataRetentionApi;
    projects: ProjectApi;
  }) {
    this.#shares = parts.shares;
    this.#retention = parts.retention;
    this.#projects = parts.projects;
  }

  static create(setup: ShareSetup): ShareModule {
    const { dataRetention, authorization, projects } = setup.dependencies;
    const repository = LedgerShareRepository.create({
      head: setup.repositories.shares,
      grants: setup.repositories.grants,
      authz: authorization,
      projects,
    });

    return new ShareModule({
      shares: ShareService.create({
        repository,
        dataRetention,
        permissions: authorization,
        projects,
        cache: setup.repositories.cache,
      }),
      retention: dataRetention,
      projects,
    });
  }

  /** Revokes a project's trace links once project records trace sharing disabled. */
  revocationPipeline(): ShareTraceSharingRevocationPipeline {
    return buildShareTraceSharingRevocationPipeline({ shares: this.#shares });
  }

  listForResource(input: ShareResourceInput): Promise<ShareLink[]> {
    return this.#shares.listForResource(input);
  }

  resolveForViewer(input: ResolveShareInput): Promise<ShareWithProject> {
    return this.#shares.resolveForViewer(input);
  }

  createShare(input: CreateShareInput): Promise<ShareLink> {
    return this.#shares.createShare(input);
  }

  revokeById(input: RevokeShareInput): Promise<void> {
    return this.#shares.revokeById(input);
  }

  unshare(input: ShareResourceInput): Promise<void> {
    return this.#shares.unshare(input);
  }

  revokeAllTraceShares(projectId: string): Promise<void> {
    return this.#shares.revokeAllTraceShares(projectId);
  }

  /**
   * A pin is retention state; share only guards the trace's release. Pin and unpin are declared
   * under `project:update`, which the permission-level write guard exempts so an admin can still
   * manage an aggregate, so each asks the project itself before writing (ADR-175 decision 8).
   */
  async pinTrace(input: PinTraceInput): Promise<PinnedTrace> {
    await this.#projects.assertAcceptsWrites({ projectId: input.projectId });

    return this.#retention.pin(input);
  }

  async unpinTrace(input: TracePinInput): Promise<void> {
    await this.#projects.assertAcceptsWrites({ projectId: input.projectId });

    return this.#shares.unpinTrace(input);
  }

  findTracePin(input: TracePinInput): Promise<PinnedTrace | null> {
    return this.#retention.findPin(input);
  }

  listTracePins(input: ShareProjectScope): Promise<PinnedTrace[]> {
    return this.#retention.listByProject(input);
  }

  findCachedPayload(input: SharedPayloadCacheInput): Promise<unknown> {
    return this.#shares.findCachedPayload(input);
  }

  cachePayload(input: SharedPayloadCacheInput & { payload: unknown }): Promise<void> {
    return this.#shares.cachePayload(input);
  }
}
