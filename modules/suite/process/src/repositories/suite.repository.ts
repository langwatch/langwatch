import type { EvaluatorAttachment } from "@langwatch/scenario-contract";
import type {
  CreateSuiteCommand,
  RunPlanConfigInput,
  Suite,
  SuiteIdInput,
  SuiteScope,
  UpdateSuiteCommand,
} from "@langwatch/suite-contract";

export abstract class SuiteRepository {
  abstract create: (input: CreateSuiteCommand & { id: string; slug: string }) => Promise<Suite>;
  abstract findAll(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]>;
  abstract resolveDynamicRunMembership(input: SuiteIdInput): Promise<string[]>;
  /**
   * The scenarios a scope covers, resolved directly against the project rather than against
   * a stored suite row — what a run PLAN needs before its plan row exists at all.
   */
  abstract resolveScopeMembership(input: {
    projectId: string;
    scope: SuiteScope;
  }): Promise<string[]>;
  abstract findById(input: SuiteIdInput): Promise<Suite | null>;
  abstract findBySlug(input: { projectId: string; slug: string }): Promise<Suite | null>;
  abstract saveManagedRunAll(input: {
    id: string;
    projectId: string;
    name: string;
    baseSlug: string;
    label: string;
    scenarioIds: string[];
    targets?: Suite["targets"];
  }): Promise<Suite>;
  /** A suite row's stored evaluators; empty when it holds none or does not exist. */
  abstract findPlanEvaluators(input: SuiteIdInput): Promise<EvaluatorAttachment[]>;
  /** The run plan a NAME joins, matched as `findOrCreatePlanByName` matches it: at most one. */
  abstract findPlanIdsByName(input: { projectId: string; name: string }): Promise<string[]>;
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
  /** A run plan's own evaluators are written with it; a plan carries no fields. */
  abstract update: (
    input: Omit<UpdateSuiteCommand, "fields"> & { slug?: string },
  ) => Promise<Suite>;
  abstract archive: (
    input: SuiteIdInput & { archivedAt: Date; archivedSlug: string },
  ) => Promise<Suite>;
}
