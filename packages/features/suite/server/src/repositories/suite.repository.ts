import type {
  CreateSuiteCommand,
  RunPlanConfigInput,
  Suite,
  SuiteIdInput,
  SuiteScope,
  UpdateSuiteCommand,
} from "@langwatch/suite-contract";

export abstract class SuiteRepository {
  abstract create(input: CreateSuiteCommand & { id: string; slug: string }): Promise<Suite>;
  abstract list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]>;
  abstract resolveDynamicRunMembership(input: SuiteIdInput): Promise<string[]>;
  /**
   * The scenarios a scope covers, resolved directly against the project rather than against
   * a stored suite row — what a run PLAN needs before its plan row exists at all.
   */
  abstract resolveScopeMembership(input: {
    projectId: string;
    scope: SuiteScope;
  }): Promise<string[]>;
  abstract tryFindById(input: SuiteIdInput): Promise<Suite | null>;
  abstract tryFindBySlug(input: { projectId: string; slug: string }): Promise<Suite | null>;
  abstract saveManagedRunAll(input: {
    id: string;
    projectId: string;
    name: string;
    baseSlug: string;
    label: string;
    scenarioIds: string[];
    targets?: Suite["targets"];
  }): Promise<Suite>;
  /**
   * The plan a NAME resolves to, matched or created, holding the given config.
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  abstract findOrCreatePlanByName(input: {
    id: string;
    projectId: string;
    name: string;
    scope: SuiteScope;
    targets: Suite["targets"];
    scenarioIds: string[];
    config: RunPlanConfigInput;
  }): Promise<{ suite: Suite; created: boolean }>;
  abstract update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite>;
  abstract archive(
    input: SuiteIdInput & { archivedAt: Date; archivedSlug: string },
  ): Promise<Suite>;
}
