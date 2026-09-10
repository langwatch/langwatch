import type {
  JoinCandidateOrganization,
  JoinRequestAggregateState,
} from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";
import type {
  JoinCandidateRepository,
  JoinRequestListReadRepository,
} from "../join-request.repository.ts";
import { MemoryIdentityStore } from "./memory-identity.store.ts";

const PENDING = "PENDING";

/** The join-request read twin: the guards' two reads plus the three list reads. */
export class MemoryJoinRequestReadRepository implements JoinRequestListReadRepository {
  static create(store: MemoryIdentityStore): MemoryJoinRequestReadRepository {
    return new MemoryJoinRequestReadRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async tryFindRequest(args: {
    joinRequestId: string;
  }): Promise<JoinRequestAggregateState | null> {
    return this.store.joinRequests.get(args.joinRequestId) ?? null;
  }

  async tryFindPendingRequest(args: {
    userId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState | null> {
    const match = [...this.store.joinRequests.values()].find(
      (request) =>
        request.userId === args.userId &&
        request.organizationId === args.organizationId &&
        request.state === PENDING,
    );

    return match ?? null;
  }

  async tryFindLastRejectionAt(args: {
    userId: string;
    organizationId: string;
  }): Promise<Instant | null> {
    return this.store.joinRejections.get(MemoryIdentityStore.rejectionKey(args)) ?? null;
  }

  async findPendingForOrganization(args: {
    organizationId: string;
  }): Promise<JoinRequestAggregateState[]> {
    return this.pending((request) => request.organizationId === args.organizationId);
  }

  async findPendingForUser(args: { userId: string }): Promise<JoinRequestAggregateState[]> {
    return this.pending((request) => request.userId === args.userId);
  }

  private pending(
    matches: (request: JoinRequestAggregateState) => boolean,
  ): JoinRequestAggregateState[] {
    return [...this.store.joinRequests.values()]
      .filter((request) => request.state === PENDING && matches(request))
      .sort((left, right) => right.createdAtMs - left.createdAtMs);
  }
}

/** The candidate twin: the organizations a domain could reach. */
export class MemoryJoinCandidateRepository implements JoinCandidateRepository {
  static create(store: MemoryIdentityStore): MemoryJoinCandidateRepository {
    return new MemoryJoinCandidateRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async findCandidateOrganizations(args: {
    domain: string;
  }): Promise<JoinCandidateOrganization[]> {
    return this.store.joinCandidates.get(args.domain) ?? [];
  }

  async tryFindCandidateOrganization(args: {
    organizationId: string;
    domain: string;
  }): Promise<JoinCandidateOrganization | null> {
    const candidates = this.store.joinCandidates.get(args.domain) ?? [];

    return candidates.find((row) => row.organizationId === args.organizationId) ?? null;
  }
}
