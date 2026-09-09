import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
  RecordPulledUsageCommand,
} from "@langwatch/enterprise-governance-contract";

/** Commands owned by the eventing process, not by the Governance domain. */
export abstract class GovernanceEventingPort {
  abstract configureIngestion(input: ConfigureIngestionPullCommand): Promise<void>;
  abstract disableIngestion(input: DisableIngestionPullCommand): Promise<void>;
  abstract recordIngestionRunCompleted(
    input: RecordIngestionPullRunCompletedCommand,
  ): Promise<void>;
  abstract recordIngestionRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
  abstract recordPulledUsage(input: RecordPulledUsageCommand): Promise<void>;
}
