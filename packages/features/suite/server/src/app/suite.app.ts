/**
 * The suite feature's application: what both of its doors call.
 *
 * It holds every service the feature reaches — suites themselves, the scenario
 * folders that ARE suites of kind "folder", the project's owning organization,
 * and the run summaries the suite list renders — and it is the one typed thing
 * a transport is given. The `SuiteApplication` type it replaces described the
 * same four capabilities, but it was a bag: any door could reach into it and
 * assemble its own version of an operation, and both did.
 *
 * What lives here as an operation is what both doors were assembling for
 * themselves:
 *
 *   - **a suite id might name a folder.** "Try the suite, fall back to the
 *     folder, and if neither is there it is not there" was written out twice,
 *     once per door, and a third writing would have been a third chance to get
 *     the fallback order wrong.
 *   - **a folder is not a run plan.** An update that names a scope or a member
 *     list is refused for a folder and accepted for a suite. Both doors made
 *     that decision, in two copies of the same three branches.
 *   - **resolving the project's organization.** Three call sites, three
 *     hand-built "Organization not found for project" refusals.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import { HandledError, ValidationError } from "@langwatch/handled-error";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  ScenarioFolder,
  ScenarioFolderCreateInput,
  ScenarioFolderIdInput,
  ScenarioService,
  SimulationExternalSetSummary,
  SimulationProjectDateRangeInput,
  SimulationService,
} from "@langwatch/scenario-contract";
import {
  SuiteNotFoundError,
  SuiteScopeNotAllowedError,
  type CreateSuiteCommand,
  type Suite,
  type SuiteArchivedNamesInput,
  type SuiteIdInput,
  type SuiteRunAllInput,
  type SuiteRunAllResult,
  type SuiteRunInput,
  type SuiteRunResult,
  type SuiteService,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";

/**
 * The project exists but no organization can be resolved behind it.
 *
 * Both doors answered 404 for this and built the refusal by hand — a
 * `TRPCError` on one side, a `c.json({ error }, 404)` on the other. It is a
 * cause we can name and the caller can act on (the project is not attached to
 * an organization they can see), so it is named here once.
 */
export class OrganizationNotFoundForProjectError extends HandledError {
  declare readonly code: "organization_not_found_for_project";

  constructor(projectId: string) {
    super("organization_not_found_for_project", "Organization not found for project", {
      httpStatus: 404,
      meta: { projectId },
    });
    this.name = "OrganizationNotFoundForProjectError";
  }
}

/**
 * What a lookup by id found. A folder IS a suite of kind "folder", but the two
 * are stored and shaped differently, so the application says which it found
 * and each door renders it the way its own wire contract always has.
 */
export type SuiteOrFolder =
  | Readonly<{ kind: "suite"; suite: Suite }>
  | Readonly<{ kind: "folder"; folder: ScenarioFolder }>;

/** What the process composes this feature's application from. */
export interface SuiteAppDependencies {
  suites: SuiteService;
  scenarios: ScenarioService;
  projects: ProjectService;
  simulations: SimulationService;
}

export class SuiteApp {
  static create(dependencies: SuiteAppDependencies): SuiteApp {
    return new SuiteApp(dependencies);
  }

  private constructor(private readonly dependencies: SuiteAppDependencies) {}

  // -- reads -----------------------------------------------------------------

  /** The project's run plans. */
  list(input: { projectId: string }): Promise<Suite[]> {
    return this.dependencies.suites.list(input);
  }

  /** The project's test-suite folders. */
  listFolders(input: { projectId: string }): Promise<ScenarioFolder[]> {
    return this.dependencies.scenarios.listFolders(input);
  }

  /**
   * One suite by id, whichever kind it turns out to be.
   *
   * The fallback order is the decision: a run plan is looked up first and a
   * folder second, so an id that names both — which cannot happen today, and
   * would be a data fault if it ever did — resolves the same way at every
   * door. Refuses with {@link SuiteNotFoundError} when neither is there.
   */
  async getByIdOrFolder(input: SuiteIdInput): Promise<SuiteOrFolder> {
    try {
      return { kind: "suite", suite: await this.dependencies.suites.get(input) };
    } catch (error) {
      if (!(error instanceof SuiteNotFoundError)) throw error;
    }

    const folder = await this.dependencies.scenarios.tryGetFolder({
      folderId: input.id,
      projectId: input.projectId,
    });
    if (!folder) throw new SuiteNotFoundError(input.id);
    return { kind: "folder", folder };
  }

  /** The names archived scenarios and targets had when a run referenced them. */
  async resolveArchivedNames(
    input: Omit<SuiteArchivedNamesInput, "organizationId">,
  ): Promise<{ scenarios: Record<string, string>; targets: Record<string, string> }> {
    const organizationId = await this.requireOrganizationId(input.projectId);
    return this.dependencies.suites.resolveArchivedNames({ ...input, organizationId });
  }

  /** The pass/fail counts the suite list renders, keyed by scenario set. */
  getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.dependencies.simulations.getInternalSuiteSummaries(input);
  }

  // -- writes ----------------------------------------------------------------

  /** A new run plan. */
  create(input: CreateSuiteCommand): Promise<Suite> {
    return this.dependencies.suites.create(input);
  }

  /** A new, empty test-suite folder. */
  createFolder(input: ScenarioFolderCreateInput): Promise<ScenarioFolder> {
    return this.dependencies.scenarios.createFolder(input);
  }

  /**
   * Updates one suite, whichever kind it turns out to be.
   *
   * A folder runs the test cases filed in it, so it takes no scope and no
   * member list; naming either is refused rather than silently dropped. Both
   * doors made that call for themselves, in two copies of the same three
   * branches, and the copies had to be read side by side to see they agreed.
   */
  async update(input: UpdateSuiteCommand): Promise<SuiteOrFolder> {
    const folder = await this.dependencies.scenarios.tryGetFolder({
      folderId: input.id,
      projectId: input.projectId,
    });
    if (!folder) {
      return { kind: "suite", suite: await this.dependencies.suites.update(input) };
    }

    if (input.scope !== undefined) throw new SuiteScopeNotAllowedError();
    if (input.scenarioIds !== undefined) {
      throw new ValidationError("A folder's scenarios are managed by filing scenarios into it", {
        meta: {
          fieldErrors: {
            scenarioIds: ["A folder's scenarios are managed by filing scenarios into it"],
          },
        },
      });
    }

    const updated = await this.dependencies.scenarios.updateFolder({
      folderId: input.id,
      projectId: input.projectId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.targets === undefined ? {} : { targets: input.targets }),
      ...(input.repeatCount === undefined ? {} : { repeatCount: input.repeatCount }),
      ...(input.labels === undefined ? {} : { labels: input.labels }),
      ...(input.simulatorModel === undefined ? {} : { simulatorModel: input.simulatorModel }),
      ...(input.judgeModel === undefined ? {} : { judgeModel: input.judgeModel }),
    });
    return { kind: "folder", folder: updated };
  }

  /** Copies a run plan, leaving the source untouched. */
  duplicate(input: SuiteIdInput): Promise<Suite> {
    return this.dependencies.suites.duplicate(input);
  }

  /** Archives a run plan. */
  archive(input: SuiteIdInput): Promise<Suite> {
    return this.dependencies.suites.archive(input);
  }

  /** Archives a folder, and every test case filed in it, in one transaction. */
  archiveFolder(input: ScenarioFolderIdInput): Promise<ScenarioFolder> {
    return this.dependencies.scenarios.archiveFolder(input);
  }

  /** Renames a folder. */
  renameFolder(input: ScenarioFolderIdInput & { name: string }): Promise<ScenarioFolder> {
    return this.dependencies.scenarios.renameFolder(input);
  }

  // -- runs ------------------------------------------------------------------

  /**
   * Schedules one suite's runs, resolving the project's organization first.
   *
   * The organization is resolved here rather than by each door because it is
   * not the caller's to supply: it is a property of the project the run is
   * scheduled in, and a door that let it arrive on the wire would let a caller
   * name someone else's.
   */
  async run(input: Omit<SuiteRunInput, "organizationId">): Promise<SuiteRunResult> {
    const organizationId = await this.requireOrganizationId(input.projectId);
    return this.dependencies.suites.run({ ...input, organizationId });
  }

  /** Schedules every non-archived test case of the project. */
  async runAll(input: Omit<SuiteRunAllInput, "organizationId">): Promise<SuiteRunAllResult> {
    const organizationId = await this.requireOrganizationId(input.projectId);
    return this.dependencies.suites.runAll({ ...input, organizationId });
  }

  // -- the project a suite belongs to ---------------------------------------

  /**
   * The organization behind a project, refusing when there is none to resolve.
   *
   * `tryGetWithTeam` returning null and `getOrganizationId` raising
   * `ProjectNotFoundError` are the same answer read two ways — the two doors
   * used one each — so both collapse to the one refusal here.
   */
  async requireOrganizationId(projectId: string): Promise<string> {
    const project = await this.dependencies.projects.tryGetWithTeam(projectId);
    if (!project) throw new OrganizationNotFoundForProjectError(projectId);
    return project.team.organizationId;
  }
}
