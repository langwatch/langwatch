/**
 * `joinRequests.*` as this feature serves it: the caller's own verified
 * address resolved once, the ledger's folded state turned into the two shapes
 * the screens render, and the requester's address deliberately withheld from
 * the organization until they are a member of it.
 */

import { Temporal, toDate } from "@langwatch/time";
import type {
  JoinRequestFiled,
  JoinRequestJoining,
  JoinRequestJoiningChanged,
  JoinRequestMine,
  JoinRequestPending,
} from "@langwatch/organization-contract";

import type {
  OrganizationDirectory,
  OrganizationJoinRequestState,
  OrganizationJoinRequests,
} from "../app/organization.members.ts";

/** Shown where the ledger knows a requester's id but nobody's name. */
const UNNAMED_COLLEAGUE = "A colleague";

export interface OrganizationJoinDoorDependencies {
  readonly joinRequests: OrganizationJoinRequests;
  readonly directory: OrganizationDirectory;
}

export class OrganizationJoinDoorService {
  static create(dependencies: OrganizationJoinDoorDependencies): OrganizationJoinDoorService {
    return new OrganizationJoinDoorService(dependencies);
  }

  private constructor(private readonly deps: OrganizationJoinDoorDependencies) {}

  /**
   * Which organizations are open to this person's own verified addresses.
   * Every closed door - unverified, consumer domain, joining off, nonexistent
   * - is the same answer.
   */
  async lookup(input: Readonly<{ userId: string }>): Promise<unknown> {
    return this.deps.joinRequests.lookup({
      userId: input.userId,
      verifiedEmail: await this.deps.directory.findVerifiedEmail(input),
    });
  }

  /** Everything this person is waiting on. */
  async listOwn(input: Readonly<{ userId: string }>): Promise<JoinRequestMine> {
    const pending = await this.deps.joinRequests.pendingForUser(input);

    return pending.map((request) => ({
      ...waitingSince(request),
      organizationId: request.organizationId,
    }));
  }

  async file(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<JoinRequestFiled> {
    return this.deps.joinRequests.request({
      userId: input.userId,
      verifiedEmail: await this.deps.directory.findVerifiedEmail({ userId: input.userId }),
      organizationId: input.organizationId,
    });
  }

  withdraw(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void> {
    return this.deps.joinRequests.withdraw(input);
  }

  /**
   * What is waiting on this organization. Who is asking, by name: the local
   * part of a requester's address is not the organization's business until
   * they are a member of it.
   */
  async listPending(input: Readonly<{ organizationId: string }>): Promise<JoinRequestPending> {
    const pending = await this.deps.joinRequests.pendingForOrganization(input);
    const names = await this.deps.directory.listUserNames({
      userIds: pending.map((request) => request.userId),
    });
    const nameById = new Map(names.map((person) => [person.id, person.name] as const));

    return pending.map((request) => ({
      ...waitingSince(request),
      userId: request.userId,
      name: nameById.get(request.userId) ?? UNNAMED_COLLEAGUE,
      domain: request.domain,
    }));
  }

  approve(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.deps.joinRequests.approve(input);
  }

  reject(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.deps.joinRequests.reject(input);
  }

  readJoining(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining> {
    return this.deps.joinRequests.readJoining(input);
  }

  setJoining(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
    }>,
  ): Promise<JoinRequestJoiningChanged> {
    return this.deps.joinRequests.setJoining(input);
  }
}

/** One waiting request, as both pending lists render it. */
function waitingSince(request: OrganizationJoinRequestState) {
  return {
    joinRequestId: request.joinRequestId,
    requestedAt: toDate(Temporal.Instant.fromEpochMilliseconds(request.createdAtMs)),
    expiresAt:
      request.expiresAtMs === null
        ? null
        : toDate(Temporal.Instant.fromEpochMilliseconds(request.expiresAtMs)),
  };
}
