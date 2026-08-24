import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./ingestion-pull.commands";
import type { RecordPulledUsageCommand } from "./pulled-usage.commands";
import type { TraceDepartmentInput } from "./department";

export abstract class GovernanceIngestionService {
  abstract configure(input: ConfigureIngestionPullCommand): Promise<void>;
  abstract disable(input: DisableIngestionPullCommand): Promise<void>;
  abstract recordRunCompleted(input: RecordIngestionPullRunCompletedCommand): Promise<void>;
  abstract recordRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
}

export abstract class GovernanceUsageService {
  abstract record(input: RecordPulledUsageCommand): Promise<void>;
}

export abstract class GovernancePolicyService {
  abstract resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;

  abstract resolveTraceDepartment(input: TraceDepartmentInput): string;
}
