import type {
  AdminDataResult,
  AdminOperationInput,
  AdminOperationResult,
} from "@langwatch/ops-contract";

/** Private persistence boundary for the Ops admin resource surface. */
export abstract class InstanceAdminRepository {
  abstract execute(input: AdminOperationInput): Promise<AdminOperationResult>;
  abstract findUserById(id: string): Promise<AdminDataResult>;
}
