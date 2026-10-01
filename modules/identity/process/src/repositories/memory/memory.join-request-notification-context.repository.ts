import { JoinRequestNotificationContextRepository } from "../join-request-notification-context.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** The notification context off the memory store: no intents, no personal teams recorded. */
export class MemoryJoinRequestNotificationContextRepository extends JoinRequestNotificationContextRepository {
  static create(store: MemoryIdentityStore): MemoryJoinRequestNotificationContextRepository {
    return new MemoryJoinRequestNotificationContextRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async getOrganizationIntent(): Promise<Readonly<{ primaryIntent: null }>> {
    return { primaryIntent: null };
  }

  async countApprovedFromDomain({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<number> {
    let approved = 0;
    for (const request of this.store.joinRequests.values()) {
      if (request.organizationId !== organizationId || request.state !== "APPROVED") continue;
      if (request.domain.toLowerCase() === domain.toLowerCase()) approved += 1;
    }
    return approved;
  }

  async findPersonalTeamSlugs(): Promise<string[]> {
    return [];
  }
}
