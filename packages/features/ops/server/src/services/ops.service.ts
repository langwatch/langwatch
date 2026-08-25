import {
  OpsService as OpsServiceContract,
  type AdminIdentity,
  type DeleteBlobInput,
  type DeleteBlobResult,
  type GetBlobInput,
  type ListBlobsInput,
  type OpsBlobPage,
  type OpsBlobSummary,
  type OpsBlobStoreStats,
  type BlobSweepReport,
  type RunBlobCleanupInput,
  type StartImpersonationInput,
  type StopImpersonationInput,
  type AdminOperationInput,
  type AdminOperationResult,
} from "@langwatch/ops-contract";
import type { AdminAccess } from "./admin-access.service";
import type { AdminBackofficeService } from "./admin-backoffice.service";
import type { ImpersonationService } from "./impersonation.service";
import type { BlobStoreService } from "./blob-store.service";

export class OpsService extends OpsServiceContract {
  private constructor(
    private readonly access: AdminAccess,
    private readonly impersonation: ImpersonationService,
    private readonly adminBackoffice: AdminBackofficeService,
    private readonly blobStore: BlobStoreService,
  ) {
    super();
  }

  static create(options: {
    access: AdminAccess;
    impersonation: ImpersonationService;
    adminBackoffice: AdminBackofficeService;
    blobStore: BlobStoreService;
  }): OpsService {
    return new OpsService(
      options.access,
      options.impersonation,
      options.adminBackoffice,
      options.blobStore,
    );
  }

  isAdmin(identity: AdminIdentity): boolean {
    return this.access.isAdmin(identity);
  }

  startImpersonation(input: StartImpersonationInput): Promise<void> {
    return this.impersonation.start(input);
  }

  stopImpersonation(input: StopImpersonationInput): Promise<void> {
    return this.impersonation.stop(input);
  }

  adminOperation(input: AdminOperationInput): Promise<AdminOperationResult> {
    return this.adminBackoffice.execute(input);
  }

  listBlobQueues(): Promise<string[]> {
    return this.blobStore.getQueueNames();
  }

  getBlobStoreStats(): Promise<OpsBlobStoreStats> {
    return this.blobStore.getStats();
  }

  listBlobs(input: ListBlobsInput): Promise<OpsBlobPage> {
    return this.blobStore.getBlobs(input);
  }

  tryGetBlob(input: GetBlobInput): Promise<OpsBlobSummary | null> {
    return this.blobStore.tryGetBlobById(input);
  }

  runBlobCleanup(input: RunBlobCleanupInput): Promise<BlobSweepReport> {
    return this.blobStore.runCleanup({
      dryRun: input.dryRun ?? true,
      requestedBy: input.requestedBy,
    });
  }

  deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult> {
    return this.blobStore.deleteBlob(input);
  }
}
