import type {
  AdminDataResult,
  AdminOperationInput,
  AdminOperationResult,
} from "@langwatch/ops-contract";

/** Private persistence boundary for the Ops admin resource surface. */
export abstract class InstanceAdminRepository {
  abstract execute(input: AdminOperationInput): Promise<AdminOperationResult>;
  abstract findUserById(id: string): Promise<AdminDataResult>;
  /** The ids of an organization's ACTIVE subscriptions. */
  abstract findActiveSubscriptionIds(input: { organizationId: string }): Promise<string[]>;
  /** A subscription's organization and status, or an empty list when it does not exist. */
  abstract findSubscriptionStates(input: {
    ids: string[];
  }): Promise<{ id: string; organizationId: string; status: string }[]>;
}
