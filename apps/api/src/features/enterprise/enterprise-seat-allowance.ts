/**
 * The seat allowances `licenseEnforcement.*` answers from, over the process's own seat gate.
 *
 * An adapter rather than a second reading: the organization half already resolves a seat
 * decision from the plan provider and the membership counts, and that is the decision the
 * members page must be shown. Two readings would let the page offer an invitation the invite
 * itself then refuses.
 */
import type {
  LicensingCaller,
  LimitCheckResult,
  LimitType,
} from "@langwatch/enterprise-licensing-contract";
import { ApiSeatAllowance } from "./enterprise.composition.ts";

/** The one decision this adapter takes off the organization half's seat gate. */
export type ApiSeatGate = Readonly<{
  checkLimit(input: {
    organizationId: string;
    resource: LimitType;
    user?: Readonly<{ id?: string; email?: string | null }> | undefined;
  }): Promise<LimitCheckResult>;
}>;

export class ApiEnterpriseSeatAllowance extends ApiSeatAllowance {
  static create(gate: ApiSeatGate): ApiEnterpriseSeatAllowance {
    return new ApiEnterpriseSeatAllowance(gate);
  }

  private constructor(private readonly gate: ApiSeatGate) {
    super();
  }

  checkLimit(
    input: Readonly<{ organizationId: string; limitType: LimitType; user: LicensingCaller }>,
  ): Promise<LimitCheckResult> {
    return this.gate.checkLimit({
      organizationId: input.organizationId,
      resource: input.limitType,
      user: input.user,
    });
  }
}
