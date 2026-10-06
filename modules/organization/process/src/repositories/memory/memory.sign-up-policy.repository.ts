import { nowInstant, type Instant } from "@langwatch/time";

import { SignUpPolicyRepository } from "../sign-up-policy.repository.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/** One invitation as the policy reads it. */
type MemorySignUpInvite = {
  email: string;
  inviteCode: string;
  status: string;
  /** Absent means the invitation never expires. */
  expiration?: Instant | null;
};

/** In-memory `SignUpPolicyRepository`, for tests and a memory-backed boot. */
export class MemorySignUpPolicyRepository extends SignUpPolicyRepository {
  readonly invites: MemorySignUpInvite[] = [];

  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  static create(options: { memory: MemoryOrganizationDatabase }): MemorySignUpPolicyRepository {
    return new MemorySignUpPolicyRepository(options.memory);
  }

  async findPendingInviteCodes({ email }: { email: string }): Promise<string[]> {
    const address = email.toLowerCase();
    const now = nowInstant();
    const invite = this.invites.find(
      (candidate) =>
        candidate.email.toLowerCase() === address &&
        candidate.status === "PENDING" &&
        (!candidate.expiration || candidate.expiration.epochMilliseconds > now.epochMilliseconds),
    );
    return invite ? [invite.inviteCode] : [];
  }

  async hasAnyOrganization(): Promise<boolean> {
    return this.memory.organizations.size > 0;
  }
}
