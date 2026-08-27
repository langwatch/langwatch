import type { CreateSuiteCommand, SuiteIdInput, UpdateSuiteCommand } from "./suite.commands";
import type {
  Suite,
  SuiteArchivedNamesInput,
  SuiteRunAllInput,
  SuiteRunAllResult,
  SuiteRunInput,
  SuiteRunResult,
  SuiteBatchHistoryInput,
  SuiteRunStateData,
  SuiteRunStateInput,
} from "./suite";

/** The sole cross-feature capability for suite definitions. */
export abstract class SuiteService {
  abstract list(input: { projectId: string }): Promise<Suite[]>;
  abstract get(input: SuiteIdInput): Promise<Suite>;
  abstract tryGet(input: SuiteIdInput): Promise<Suite | null>;
  abstract create(input: CreateSuiteCommand): Promise<Suite>;
  abstract update(input: UpdateSuiteCommand): Promise<Suite>;
  abstract duplicate(input: SuiteIdInput): Promise<Suite>;
  abstract archive(input: SuiteIdInput): Promise<Suite>;
  abstract run(input: SuiteRunInput): Promise<SuiteRunResult>;
  abstract runAll(input: SuiteRunAllInput): Promise<SuiteRunAllResult>;
  abstract getSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null>;
  abstract getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]>;
  abstract resolveArchivedNames(input: SuiteArchivedNamesInput): Promise<{
    scenarios: Record<string, string>;
    targets: Record<string, string>;
  }>;
}
