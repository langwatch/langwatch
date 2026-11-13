import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import {
  type StaffAccessActor,
  STAFF_ACCESS_FLAG,
  StaffAccessNotFoundError,
} from "@langwatch/staff-access-contract";

/**
 * Whether staff access exists on this deployment: cloud ops and the system flag, both. Every
 * surface answers the same hidden `not_found` while either is off (ADR-202).
 */
export class StaffAccessAvailabilityService {
  private constructor(
    private readonly deps: {
      ops: Pick<OpsApi, "offersCloudOps">;
      featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    },
  ) {}

  static create(deps: {
    ops: Pick<OpsApi, "offersCloudOps">;
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): StaffAccessAvailabilityService {
    return new StaffAccessAvailabilityService(deps);
  }

  async isOpen(): Promise<boolean> {
    if (!this.deps.ops.offersCloudOps()) return false;
    return this.deps.featureFlags.isEnabled(STAFF_ACCESS_FLAG, { kind: "system" });
  }

  /** @throws {StaffAccessNotFoundError} while the surface is off */
  async assertOpen(): Promise<void> {
    if (!(await this.isOpen())) throw new StaffAccessNotFoundError();
  }

  /**
   * The operator acting in their own name. An impersonated session never reaches staff access:
   * the passkey and the approval are the operator's own.
   * @throws {StaffAccessNotFoundError} while off, or for anyone but a signed-in operator
   */
  async operatorOf({ actor }: { actor: StaffAccessActor }): Promise<{ userId: string }> {
    await this.assertOpen();
    if (actor.type !== "user" || !actor.id || actor.impersonatorId) {
      throw new StaffAccessNotFoundError();
    }
    return { userId: actor.id };
  }
}
