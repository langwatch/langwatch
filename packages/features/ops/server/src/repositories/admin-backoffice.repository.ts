import type {
  AdminDataResult,
  AdminOperationInput,
  AdminOperationResult,
} from "@langwatch/ops-contract";

/** Private persistence boundary for the Ops backoffice resource surface. */
export abstract class AdminBackofficeRepository {
  abstract execute(input: AdminOperationInput): Promise<AdminOperationResult>;
  abstract findUserById(id: string): Promise<AdminDataResult>;
  abstract setUserDeactivatedAt(id: string, value: Date): Promise<void>;
}
