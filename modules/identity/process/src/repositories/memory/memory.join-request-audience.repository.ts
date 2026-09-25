import { JoinRequestNotFoundError } from "@langwatch/identity-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { UserNotFoundError } from "@langwatch/user-contract";

import type {
  JoinRequestAudienceProfile,
  JoinRequestAudienceRepository,
} from "../join-request-audience.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** Who a join-request notice reaches, read off the memory store's own rows. */
export class MemoryJoinRequestAudienceRepository implements JoinRequestAudienceRepository {
  static create(store: MemoryIdentityStore): MemoryJoinRequestAudienceRepository {
    return new MemoryJoinRequestAudienceRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async getRequesterId({ joinRequestId }: { joinRequestId: string }): Promise<string> {
    const request = this.store.joinRequests.get(joinRequestId);
    if (!request) {
      throw new JoinRequestNotFoundError(`join request ${joinRequestId} does not exist`);
    }
    return request.userId;
  }

  async getOrganizationName({ organizationId }: { organizationId: string }): Promise<string> {
    const name = this.store.organizationNames.get(organizationId);
    if (name === undefined) throw new OrganizationNotFoundError(organizationId);
    return name;
  }

  async findAdminEmails({ organizationId }: { organizationId: string }): Promise<string[]> {
    return [...(this.store.organizationAdminEmails.get(organizationId) ?? [])];
  }

  async getUserProfile({ userId }: { userId: string }): Promise<JoinRequestAudienceProfile> {
    const user = this.store.users.get(userId);
    if (!user) throw new UserNotFoundError(userId);
    const name = user.payload.name;
    return { name: typeof name === "string" ? name : null, email: user.email };
  }
}
