import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./ingestion-pull.commands";
import type { RecordPulledUsageCommand } from "./pulled-usage.commands";

export abstract class GovernanceIngestionService {
  abstract configure(input: ConfigureIngestionPullCommand): Promise<void>;
  abstract disable(input: DisableIngestionPullCommand): Promise<void>;
  abstract recordRunCompleted(input: RecordIngestionPullRunCompletedCommand): Promise<void>;
  abstract recordRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
}

export abstract class GovernanceUsageService {
  abstract record(input: RecordPulledUsageCommand): Promise<void>;
}
