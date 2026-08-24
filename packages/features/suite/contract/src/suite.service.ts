import type { CreateSuiteCommand, SuiteIdInput, UpdateSuiteCommand } from "./suite.commands";
import type { Suite } from "./suite";

/** The sole cross-feature capability for suite definitions. */
export abstract class SuiteService {
  abstract list(input: { projectId: string }): Promise<Suite[]>;
  abstract get(input: SuiteIdInput): Promise<Suite>;
  abstract tryGet(input: SuiteIdInput): Promise<Suite | null>;
  abstract create(input: CreateSuiteCommand): Promise<Suite>;
  abstract update(input: UpdateSuiteCommand): Promise<Suite>;
  abstract duplicate(input: SuiteIdInput): Promise<Suite>;
  abstract archive(input: SuiteIdInput): Promise<Suite>;
}
