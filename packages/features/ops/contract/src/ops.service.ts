import type {
  AdminIdentity,
  StartImpersonationInput,
  StopImpersonationInput,
} from "./admin";
import type {
  DeleteBlobInput,
  DeleteBlobResult,
  GetBlobInput,
  ListBlobsInput,
  OpsBlobPage,
  OpsBlobSummary,
  OpsBlobStoreStats,
  BlobSweepReport,
  RunBlobCleanupInput,
} from "./blob-store";
import type { AdminOperationInput, AdminOperationResult } from "./admin-backoffice";

/** The single portable capability for platform operations and backoffice work. */
export abstract class OpsService {
  abstract isAdmin(identity: AdminIdentity): boolean;
  abstract startImpersonation(input: StartImpersonationInput): Promise<void>;
  abstract stopImpersonation(input: StopImpersonationInput): Promise<void>;
  abstract adminOperation(input: AdminOperationInput): Promise<AdminOperationResult>;
  abstract listBlobQueues(): Promise<string[]>;
  abstract getBlobStoreStats(): Promise<OpsBlobStoreStats>;
  abstract listBlobs(input: ListBlobsInput): Promise<OpsBlobPage>;
  abstract tryGetBlob(input: GetBlobInput): Promise<OpsBlobSummary | null>;
  abstract runBlobCleanup(input: RunBlobCleanupInput): Promise<BlobSweepReport>;
  abstract deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult>;
}
