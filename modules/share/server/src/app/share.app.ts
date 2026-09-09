import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  type PinnedTrace,
  type PinTraceInput,
} from "@langwatch/data-retention-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
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
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { LedgerShareRepository } from "../repositories/ledger/ledger.share.repository.ts";
import { RedisShareCacheRepository } from "../repositories/redis/redis.share-cache.repository.ts";
import type { ShareRepositories } from "../repositories/share.repositories.ts";
import { ShareService } from "../services/share.service.ts";

/** The viewer cache this process owns; `null` runs the ledger uncached. */
export type ShareInfrastructure = Readonly<{
  redis: IORedis | Cluster | null;
}>;

type ShareSetup = FeatureSetup<
  typeof ShareApp.dependencies,
  ShareInfrastructure,
  undefined,
  ShareRepositories
>;

export class ShareApp implements ShareApiContract {
  static readonly contract = ShareApi;
  static readonly dependencies = {
    dataRetention: DataRetentionApi,
    authorization: AuthzApi,
    projects: ProjectApi,
  };

  readonly #shares: ShareService;
  readonly #retention: DataRetentionApi;

  private constructor(shares: ShareService, retention: DataRetentionApi) {
    this.#shares = shares;
    this.#retention = retention;
  }

  static create(setup: ShareSetup): ShareApp {
    const { dataRetention, authorization, projects } = setup.dependencies;
    const repository = LedgerShareRepository.create({
      head: setup.repositories.shares,
      grants: setup.repositories.grants,
      authz: authorization,
      projects,
    });

    return new ShareApp(
      ShareService.create({
        repository,
        dataRetention,
        permissions: authorization,
        projects,
        cache: RedisShareCacheRepository.create({ redis: setup.infrastructure.redis }),
      }),
      dataRetention,
    );
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

  /** A pin is retention state; share only guards the trace's release. */
  pinTrace(input: PinTraceInput): Promise<PinnedTrace> {
    return this.#retention.pin(input);
  }

  unpinTrace(input: TracePinInput): Promise<void> {
    return this.#shares.unpinTrace(input);
  }

  findTracePin(input: TracePinInput): Promise<PinnedTrace | null> {
    return this.#retention.tryGetPin(input);
  }

  listTracePins(input: ShareProjectScope): Promise<PinnedTrace[]> {
    return this.#retention.listByProject(input);
  }

  findCachedPayload(input: SharedPayloadCacheInput): Promise<unknown | null> {
    return this.#shares.findCachedPayload(input);
  }

  cachePayload(input: SharedPayloadCacheInput & { payload: unknown }): Promise<void> {
    return this.#shares.cachePayload(input);
  }
}
