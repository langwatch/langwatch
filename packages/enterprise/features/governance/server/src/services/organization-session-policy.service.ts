import { HandledError } from "@langwatch/handled-error";
import {
  OrganizationSessionPolicyPort,
  type OrganizationSessionPolicy,
} from "../ports/session-policy.port";

/**
 * The maximum lifetime an organization admin may enforce on CLI/device
 * sessions. Zero means unbounded; the hard cap of 365 keeps a silent typo of
 * "9999" from making the field effectively meaningless. Values above the
 * refresh-token's natural life (~30d) still no-op at `/exchange`, so the cap
 * is a UX guardrail rather than a security invariant.
 */
export const SESSION_POLICY_MAX_DAYS = 365;

export class SessionPolicyOutOfRangeError extends HandledError {
  constructor(
    readonly value: number,
    readonly maxDays: number,
  ) {
    super(
      "governance:session_policy_out_of_range",
      `maxSessionDurationDays must be an integer between 0 and ${maxDays} (got ${value})`,
      {
        httpStatus: 400,
        meta: { value, maxDays },
      },
    );
  }
}

/** Read and update the organization's session-lifetime policy. */
export class OrganizationSessionPolicyService {
  private constructor(private readonly repository: OrganizationSessionPolicyPort) {}

  static create(repository: OrganizationSessionPolicyPort): OrganizationSessionPolicyService {
    return new OrganizationSessionPolicyService(repository);
  }

  async get(organizationId: string): Promise<OrganizationSessionPolicy> {
    return this.repository.find(organizationId);
  }

  async setMaxDurationDays(
    organizationId: string,
    maxSessionDurationDays: number,
  ): Promise<OrganizationSessionPolicy> {
    if (
      !Number.isInteger(maxSessionDurationDays) ||
      maxSessionDurationDays < 0 ||
      maxSessionDurationDays > SESSION_POLICY_MAX_DAYS
    ) {
      throw new SessionPolicyOutOfRangeError(maxSessionDurationDays, SESSION_POLICY_MAX_DAYS);
    }
    await this.repository.setMaxDurationDays(organizationId, maxSessionDurationDays);
    return { maxSessionDurationDays };
  }
}
