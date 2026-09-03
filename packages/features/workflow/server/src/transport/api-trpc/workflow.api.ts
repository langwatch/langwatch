/**
 * The workflow feature's own tRPC surface, mounted by a host process at
 * `workflow.*`.
 *
 * Everything a workflow IS — its versions, its copies, its publication state,
 * its archive cascade — is answered here, by delegating to `WorkflowApp`
 * or, where the read is still a host-owned row, to a port the mount supplies.
 * The transport itself owns only procedure names, input parsing, the tRPC
 * error codes each failure maps to, and the shape of what goes back.
 *
 * Reading takes `workflows:view`, editing `workflows:update`, creating and
 * copying `workflows:create`, archiving `workflows:delete`.
 *
 * Cross-project authorization is deliberately imperative rather than declared:
 * `copy`, `getCopies`, `syncFromSource` and `pushToCopies` each act on a
 * SECOND project the caller named, and the declared check only covers the
 * scope id in `projectId`. Those procedures probe the other project through
 * `ports.hasProjectPermission` and refuse themselves — the same two-step the
 * application router performed before this moved.
 *
 * Spec: packages/features/workflow/specs/workflow-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  clearDsl,
  migrateDSLVersion,
  parseStudioWorkflow,
  recursiveAlphabeticallySortedKeys,
  workflowApiArchiveInputSchema,
  workflowApiAutosaveInputSchema,
  workflowApiCommitVersionInputSchema,
  workflowApiCopyInputSchema,
  workflowApiCreateInputSchema,
  workflowApiEngineModeInputSchema,
  workflowApiGenerateCommitMessageInputSchema,
  workflowApiGetByIdInputSchema,
  workflowApiGetVersionsInputSchema,
  workflowApiProjectInputSchema,
  workflowApiPublishInputSchema,
  workflowApiPushToCopiesInputSchema,
  workflowApiRestoreVersionInputSchema,
  workflowApiWorkflowInputSchema,
  WorkflowNotFoundError,
  WorkflowVersionNotFoundError,
  type StudioWorkflow,
  type Workflow,
  type WorkflowApiAutosaveOutput,
  type WorkflowApiCommitVersionOutput,
  type WorkflowApiGenerateCommitMessageOutput,
  type WorkflowApiPublishOutput,
  type WorkflowApiRestoreVersionOutput,
  type WorkflowVersion,
  type WorkflowVersionHistoryEntry,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type { WorkflowApp } from "#app/workflow.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the host's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. A REST door, whose service is
 * built per family, would hold {@link WorkflowApp} directly; both reach the
 * same object and only the path to it differs.
 */
export type WorkflowTrpcContext = Readonly<{
  app: Readonly<{ workflows: WorkflowApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type WorkflowTrpcProcedures<
  TContext extends WorkflowTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * One stored version, as the rows this transport reads carry it.
 *
 * `dsl` is `unknown` on purpose: the host reads it out of a JSON column and
 * this transport re-parses it with `parseStudioWorkflow` before touching it,
 * so typing it as a graph here would assert a shape nothing has checked.
 */
export type WorkflowVersionRow = Readonly<{ version: string; dsl: unknown }>;

/** A workflow row plus the latest-version pointer the copy flows read off it. */
export type WorkflowRowWithLatestVersion = Workflow & {
  latestVersion: WorkflowVersionRow | null;
};

/** The row `syncFromSource` reads: the copy, and the workflow it was copied from. */
export type WorkflowSourceRow = WorkflowRowWithLatestVersion & {
  copiedFrom: WorkflowRowWithLatestVersion | null;
};

/** The row `pushToCopies` reads: the source, and every non-archived copy of it. */
export type WorkflowCopiesRow = WorkflowRowWithLatestVersion & {
  copiedWorkflows: readonly (Workflow & { latestVersion: WorkflowVersionRow | null })[];
};

/** Where a project sits, for the "org / team / project" path a copy is shown under. */
export type WorkflowProjectPath = Readonly<{
  id: string;
  name: string;
  team: Readonly<{
    id: string;
    name: string;
    organization: Readonly<{ id: string; name: string }>;
  }>;
}>;

/** One copy of a workflow, with enough lineage to render where it lives. */
export type WorkflowCopyRow = Readonly<{
  id: string;
  name: string;
  projectId: string;
  project: WorkflowProjectPath;
}>;

/**
 * A listed workflow with its copy lineage in both directions.
 *
 * The lineage is read unfiltered and redacted here against the caller's
 * per-project permissions, so the list can never leak the name of a project
 * the caller cannot see.
 */
export type WorkflowListRow = Readonly<{
  id: string;
  projectId: string;
  name: string;
  icon: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  latestVersionId: string | null;
  currentVersionId: string | null;
  publishedId: string | null;
  publishedById: string | null;
  archivedAt: Date | null;
  isEvaluator: boolean;
  isComponent: boolean;
  copiedFromWorkflowId: string | null;
  copiedFrom: Readonly<{
    id: string;
    name: string;
    projectId: string;
    project: WorkflowProjectPath;
  }> | null;
  copiedWorkflows: readonly Readonly<{ projectId: string }>[];
}>;

/** What `cascadeArchive` did, in one transaction. */
export type WorkflowCascadeArchiveResult = Readonly<{
  workflow: Workflow;
  archivedEvaluatorsCount: number;
  archivedAgentsCount: number;
  deletedMonitorsCount: number;
}>;

/**
 * The host capabilities this transport needs.
 *
 * Two kinds live here, and only two. Reads the workflow service does not own
 * yet — copy lineage, the archive cascade, the agents and monitors that hang
 * off a workflow — and capabilities that are the process's rather than the
 * feature's: the permission probe, the model call behind commit-message
 * generation, and the nurturing signal a first workflow fires.
 */
export type WorkflowTrpcPorts = Readonly<{
  /** Whether the caller holds `permission` on a project other than the scoped one. */
  hasProjectPermission(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectId: string; permission: AuthzPermission }>,
  ): Promise<boolean>;
  /**
   * The same probe for many projects at once. Bounded concurrency is the
   * host's concern — a workflow with many copies must not exhaust its
   * connection pool — so the cap lives with the process that owns the pool.
   */
  hasProjectPermissions(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectIds: readonly string[]; permission: AuthzPermission }>,
  ): Promise<ReadonlyMap<string, boolean>>;
  /**
   * Host-owned preparation of a Studio graph before it is persisted: local
   * node configuration is merged in and each LLM node's configuration is
   * materialised against the project's model providers.
   */
  prepareDsl(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectId: string; dsl: StudioWorkflow }>,
  ): Promise<StudioWorkflow>;
  /**
   * Persist a version through the host's save path, which prepares the graph
   * and dispatches the agent-mapping recompute alongside the write.
   */
  saveWorkflowVersion(
    ctx: WorkflowTrpcContext,
    input: Readonly<{
      projectId: string;
      workflowId: string;
      dsl: StudioWorkflow;
      autoSaved: boolean;
      commitMessage: string;
      setAsLatestVersion?: boolean;
    }>,
  ): Promise<WorkflowVersion>;
  /** Every non-archived workflow in the project, newest edit first, with lineage. */
  listWorkflowsWithCopyLineage(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<readonly WorkflowListRow[]>;
  /** One non-archived workflow in the project, or null. */
  tryFindWorkflow(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<Readonly<{ projectId: string }> | null>;
  /** Every non-archived copy of a workflow, with the path each one lives under. */
  tryFindCopiesWithPath(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<readonly WorkflowCopyRow[] | null>;
  /** The workflow and the workflow it was copied from, or null. */
  tryFindWorkflowWithSource(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<WorkflowSourceRow | null>;
  /** The workflow and every non-archived copy of it, or null. */
  tryFindWorkflowWithCopies(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<WorkflowCopiesRow | null>;
  /**
   * The latest version NUMBER of one workflow. Null when the workflow row is
   * gone; `version: null` when it exists but has no latest version — the two
   * are distinguished because a vanished copy is skipped and a versionless one
   * starts from "0.0".
   */
  tryFindLatestVersionNumber(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<Readonly<{ version: string | null }> | null>;
  /** Non-archived agents that run this workflow. */
  listAgentsForWorkflow(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<readonly Readonly<{ id: string; name: string }>[]>;
  /** Monitors bound to any of these evaluators. */
  listMonitorsForEvaluators(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectId: string; evaluatorIds: readonly string[] }>,
  ): Promise<readonly Readonly<{ id: string; name: string; evaluatorId: string }>[]>;
  /**
   * Archive the workflow and everything that points at it, atomically:
   * linked evaluators and agents are archived, and the monitors those
   * evaluators back are deleted outright.
   */
  cascadeArchiveWorkflow(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectId: string; workflowId: string; unarchive?: boolean }>,
  ): Promise<WorkflowCascadeArchiveResult>;
  /**
   * The model call behind an autogenerated commit message. The diff is this
   * transport's; resolving the project's model and translating a provider
   * failure into something the studio can render are the host's.
   */
  generateCommitMessage(
    ctx: WorkflowTrpcContext,
    input: Readonly<{ projectId: string; previousDsl: string; nextDsl: string }>,
  ): Promise<string>;
  /** Fire-and-forget product signal for a project's newly created workflow. */
  workflowCreated(
    ctx: WorkflowTrpcContext,
    input: Readonly<{
      userId: string;
      workflowCount: number;
      workflowId: string;
      projectId: string;
    }>,
  ): void;
  /** Where a fire-and-forget failure goes when nothing is waiting on it. */
  captureException(error: unknown): void;
}>;

/** The comparable text of a graph: local configuration stripped, keys sorted. */
const comparableDsl = (dsl: StudioWorkflow): string =>
  JSON.stringify(recursiveAlphabeticallySortedKeys(clearDsl(dsl)), null, 2);

/** The next major version a copy takes, counted from its OWN history. */
const nextMajorVersion = (current: string | null | undefined): string => {
  const [versionMajor] = (current ?? "0.0").split(".");
  return `${parseInt(versionMajor ?? "0") + 1}`;
};

/** Deep-clones a persisted graph so the caller may mutate it freely. */
const cloneDsl = (dsl: unknown): StudioWorkflow =>
  parseStudioWorkflow(JSON.parse(JSON.stringify(dsl)));

/**
 * Installs the complete `workflow.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class WorkflowTrpcApi {
  static create<
    TContext extends WorkflowTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: WorkflowTrpcProcedures<TContext, TOptions, TRoot>,
    ports: WorkflowTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * Which NLP engine is active for the project. The studio reads this to
       * hide the (now defunct) Optimize button: optimization was DSPy-only and
       * the Go engine never shipped DSPy, so with nlpgo the only engine the
       * button is always hidden. Kept as a procedure rather than a UI constant
       * so the studio handlers and the UI agree on one source of truth.
       */
      engineMode: policy("workflows:view")(procedure.input(workflowApiEngineModeInputSchema)).query(
        () => {
          return {
            engineMode: "go" as const,
            optimizeEnabled: false as const,
          };
        },
      ),

      create: policy("workflows:create")(procedure.input(workflowApiCreateInputSchema)).mutation(
        async ({ ctx, input }) => {
          const dsl = await ports.prepareDsl(ctx, {
            projectId: input.projectId,
            dsl: input.dsl,
          });
          const { workflow, version } = await ctx.app.workflows.create(
            {
              projectId: input.projectId,
              dsl,
              commitMessage: input.commitMessage,
              publish: input.publish,
            },
            ctx.actor(),
          );

          void ctx.app.workflows
            .list({ projectId: input.projectId })
            .then((workflows) => {
              ports.workflowCreated(ctx, {
                userId: ctx.actor().id,
                workflowCount: workflows.length,
                workflowId: workflow.id,
                projectId: input.projectId,
              });
            })
            .catch(ports.captureException);

          return { workflow, version };
        },
      ),

      /**
       * Copying reaches into a SECOND project, which the declared check on
       * `projectId` does not cover — so the caller must also be able to create
       * workflows in the source project.
       */
      copy: policy("workflows:create")(procedure.input(workflowApiCopyInputSchema)).mutation(
        async ({ ctx, input }) => {
          const hasSourcePermission = await ports.hasProjectPermission(ctx, {
            projectId: input.sourceProjectId,
            permission: "workflows:create",
          });

          if (!hasSourcePermission) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to create workflows in the source project",
            });
          }

          const { workflow, version } = await ctx.app.workflows.copy(
            {
              sourceWorkflowId: input.workflowId,
              targetProjectId: input.projectId,
              sourceProjectId: input.sourceProjectId,
              copyDatasets: input.copyDatasets,
              copiedFromWorkflowId: input.workflowId,
            },
            ctx.actor(),
          );
          return { workflow, version };
        },
      ),

      /**
       * The project's workflows, with copy lineage redacted to what the caller
       * may see: a source workflow in a project they cannot view is hidden
       * entirely, and the copy count only counts copies they can view.
       */
      getAll: policy("workflows:view")(procedure.input(workflowApiProjectInputSchema)).query(
        async ({ ctx, input }) => {
          const workflows = await ports.listWorkflowsWithCopyLineage(ctx, {
            projectId: input.projectId,
          });

          const relatedProjectIds = [
            ...new Set(
              workflows.flatMap((workflow) => [
                ...(workflow.copiedFrom ? [workflow.copiedFrom.projectId] : []),
                ...workflow.copiedWorkflows.map((copy) => copy.projectId),
              ]),
            ),
          ];
          const probed = await ports.hasProjectPermissions(ctx, {
            projectIds: relatedProjectIds.filter((projectId) => projectId !== input.projectId),
            permission: "workflows:view",
          });
          const isVisible = (projectId: string) =>
            projectId === input.projectId || probed.get(projectId) === true;

          return workflows.map(({ copiedWorkflows, ...workflow }) => {
            const canSeeSource = workflow.copiedFrom && isVisible(workflow.copiedFrom.projectId);
            return {
              ...workflow,
              copiedFromWorkflowId: canSeeSource ? workflow.copiedFromWorkflowId : null,
              copiedFrom: canSeeSource ? workflow.copiedFrom : null,
              _count: {
                copiedWorkflows: copiedWorkflows.filter((copy) => isVisible(copy.projectId)).length,
              },
            };
          });
        },
      ),

      /**
       * The copies of a workflow the caller could actually push to. A copy in
       * a project they cannot update is withheld rather than shown greyed out,
       * because the only action the list offers is a push.
       */
      getCopies: policy("workflows:view")(procedure.input(workflowApiWorkflowInputSchema)).query(
        async ({ ctx, input }) => {
          const workflow = await ports.tryFindWorkflow(ctx, {
            workflowId: input.workflowId,
            projectId: input.projectId,
          });

          if (!workflow) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Workflow not found",
            });
          }

          const hasPermission = await ports.hasProjectPermission(ctx, {
            projectId: workflow.projectId,
            permission: "workflows:view",
          });

          if (!hasPermission) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to view this workflow",
            });
          }

          const copies = await ports.tryFindCopiesWithPath(ctx, {
            workflowId: input.workflowId,
            projectId: input.projectId,
          });

          if (!copies) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Workflow not found",
            });
          }

          const copiesWithPermissions = await Promise.all(
            copies.map(async (copy) => {
              const hasCopyPermission = await ports.hasProjectPermission(ctx, {
                projectId: copy.projectId,
                permission: "workflows:update",
              });
              return {
                id: copy.id,
                name: copy.name,
                projectId: copy.projectId,
                projectName: copy.project.name,
                teamName: copy.project.team.name,
                organizationName: copy.project.team.organization.name,
                fullPath: `${copy.project.team.organization.name} / ${copy.project.team.name} / ${copy.project.name}`,
                hasPermission: hasCopyPermission,
              };
            }),
          );

          // An empty result is the same answer whether there are no copies or
          // none the caller may update: the page renders "No copies found"
          // either way rather than naming a project they cannot see.
          return copiesWithPermissions.filter((copy) => copy.hasPermission);
        },
      ),

      getById: policy("workflows:view")(procedure.input(workflowApiGetByIdInputSchema)).query(
        async ({ ctx, input }): Promise<WorkflowWithVersion> => {
          let workflow;
          try {
            workflow = await ctx.app.workflows.getById({
              id: input.workflowId,
              projectId: input.projectId,
              includeVersion: true,
            });
          } catch (error) {
            if (error instanceof WorkflowNotFoundError) {
              throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            }
            throw error;
          }

          if (workflow.currentVersion) {
            workflow.currentVersion.dsl = migrateDSLVersion(workflow.currentVersion.dsl);
          }

          return workflow;
        },
      ),

      getVersions: policy("workflows:view")(
        procedure.input(workflowApiGetVersionsInputSchema),
      ).query(async ({ ctx, input }): Promise<WorkflowVersionHistoryEntry[]> => {
        try {
          return await ctx.app.workflows.getVersionHistory({
            workflowId: input.workflowId,
            projectId: input.projectId,
            mode:
              input.returnDSL === true
                ? "allDsl"
                : input.returnDSL === "previousVersion"
                  ? "previousDsl"
                  : "metadata",
          });
        } catch (error) {
          if (!(error instanceof WorkflowNotFoundError)) throw error;
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
      }),

      restoreVersion: policy("workflows:update")(
        procedure.input(workflowApiRestoreVersionInputSchema),
      ).mutation(async ({ ctx, input }): Promise<WorkflowApiRestoreVersionOutput> => {
        try {
          return await ctx.app.workflows.restoreVersion({
            versionId: input.versionId,
            projectId: input.projectId,
          });
        } catch (error) {
          if (
            !(error instanceof WorkflowVersionNotFoundError) &&
            !(error instanceof WorkflowNotFoundError)
          ) {
            throw error;
          }
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              error instanceof WorkflowVersionNotFoundError
                ? "Workflow version not found"
                : "Workflow not found",
          });
        }
      }),

      autosave: policy("workflows:update")(
        procedure.input(workflowApiAutosaveInputSchema),
      ).mutation(async ({ ctx, input }): Promise<WorkflowApiAutosaveOutput> => {
        return await ports.saveWorkflowVersion(ctx, {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: input.dsl,
          autoSaved: true,
          commitMessage: "Autosaved",
          setAsLatestVersion: input.setAsLatestVersion,
        });
      }),

      commitVersion: policy("workflows:update")(
        procedure.input(workflowApiCommitVersionInputSchema),
      ).mutation(async ({ ctx, input }): Promise<WorkflowApiCommitVersionOutput> => {
        return await ports.saveWorkflowVersion(ctx, {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: input.dsl,
          autoSaved: false,
          commitMessage: input.commitMessage,
        });
      }),

      publish: policy("workflows:update")(procedure.input(workflowApiPublishInputSchema)).mutation(
        async ({ ctx, input }): Promise<WorkflowApiPublishOutput> => {
          return ctx.app.workflows.publish(
            {
              id: input.workflowId,
              projectId: input.projectId,
              versionId: input.versionId,
            },
            ctx.actor(),
          );
        },
      ),

      unpublish: policy("workflows:update")(
        procedure.input(workflowApiWorkflowInputSchema),
      ).mutation(async ({ ctx, input }) => {
        return ctx.app.workflows.unpublish({
          id: input.workflowId,
          projectId: input.projectId,
        });
      }),

      /**
       * Pulls the source workflow's latest graph into this copy as a new
       * version. The version number continues THIS copy's history, not the
       * source's, so a copy that has diverged does not jump backwards.
       */
      syncFromSource: policy("workflows:update")(
        procedure.input(workflowApiWorkflowInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const workflow = await ports.tryFindWorkflowWithSource(ctx, {
          workflowId: input.workflowId,
          projectId: input.projectId,
        });

        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (!workflow.copiedFromWorkflowId || !workflow.copiedFrom) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This workflow is not a copy and has no source to sync from",
          });
        }

        if (workflow.copiedFrom.archivedAt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source workflow has been archived",
          });
        }

        const sourceWorkflow = workflow.copiedFrom;

        if (!sourceWorkflow.latestVersion?.dsl) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source workflow or its latest version not found",
          });
        }

        const hasSourcePermission = await ports.hasProjectPermission(ctx, {
          projectId: sourceWorkflow.projectId,
          permission: "workflows:view",
        });

        if (!hasSourcePermission) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to view workflows in the source project",
          });
        }

        const nextVersion = nextMajorVersion(workflow.latestVersion?.version);

        const dsl = cloneDsl(sourceWorkflow.latestVersion.dsl);
        dsl.workflow_id = workflow.id;

        const version = await ports.saveWorkflowVersion(ctx, {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: { ...dsl, version: nextVersion },
          autoSaved: false,
          commitMessage: "Updated from source workflow",
        });

        return { workflow, version };
      }),

      /**
       * Pushes this workflow's latest graph out to its copies. Copies in
       * projects the caller cannot update are skipped silently; if that leaves
       * nothing, the whole push is refused rather than reported as a no-op.
       */
      pushToCopies: policy("workflows:update")(
        procedure.input(workflowApiPushToCopiesInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const workflow = await ports.tryFindWorkflowWithCopies(ctx, {
          workflowId: input.workflowId,
          projectId: input.projectId,
        });

        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (!workflow.latestVersion?.dsl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This workflow has no latest version to push",
          });
        }

        if (workflow.copiedWorkflows.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This workflow has no copies to push to",
          });
        }

        const copyIds = input.copyIds;
        const copiesToPush = copyIds
          ? workflow.copiedWorkflows.filter((copy) => copyIds.includes(copy.id))
          : workflow.copiedWorkflows;

        if (copiesToPush.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No valid copies selected to push to",
          });
        }

        const dsl = cloneDsl(workflow.latestVersion.dsl);

        const results = [];

        for (const copy of copiesToPush) {
          const hasCopyPermission = await ports.hasProjectPermission(ctx, {
            projectId: copy.projectId,
            permission: "workflows:update",
          });

          if (!hasCopyPermission) {
            continue;
          }

          // Each copy keeps its own version history, so the next number is
          // read from the copy rather than from the source being pushed.
          const copyLatest = await ports.tryFindLatestVersionNumber(ctx, {
            workflowId: copy.id,
            projectId: copy.projectId,
          });

          if (!copyLatest) {
            continue;
          }

          const nextVersion = nextMajorVersion(copyLatest.version);

          const copyDsl = cloneDsl(dsl);
          copyDsl.workflow_id = copy.id;

          const version = await ports.saveWorkflowVersion(ctx, {
            projectId: copy.projectId,
            workflowId: copy.id,
            dsl: { ...copyDsl, version: nextVersion },
            autoSaved: false,
            commitMessage: "Updated from source workflow",
          });

          results.push({ copyId: copy.id, copyName: copy.name, version });
        }

        if (results.length === 0) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to update any of the copied workflows",
          });
        }

        return {
          pushedTo: results.length,
          totalCopies: workflow.copiedWorkflows.length,
          selectedCopies: copiesToPush.length,
          results,
        };
      }),

      /**
       * What archiving this workflow would take with it — the evaluators and
       * agents bound to it, and the monitors those evaluators back. Read by
       * the confirmation dialog before `cascadeArchive` is called.
       */
      getRelatedEntities: policy("workflows:view")(
        procedure.input(workflowApiWorkflowInputSchema),
      ).query(async ({ ctx, input }) => {
        const evaluators = (
          await ctx.app.workflows.listEvaluators({
            projectId: input.projectId,
          })
        )
          .filter((evaluator) => evaluator.workflowId === input.workflowId)
          .map(({ id, name }) => ({ id, name }));

        // Copied out of the ports' readonly views: the confirmation dialog
        // these lists feed types them as plain arrays, and a readonly element
        // type would narrow a client payload that is identical on the wire.
        const agents = [
          ...(await ports.listAgentsForWorkflow(ctx, {
            workflowId: input.workflowId,
            projectId: input.projectId,
          })),
        ];

        const evaluatorIds = evaluators.map((evaluator) => evaluator.id);
        const monitors =
          evaluatorIds.length > 0
            ? [
                ...(await ports.listMonitorsForEvaluators(ctx, {
                  projectId: input.projectId,
                  evaluatorIds,
                })),
              ]
            : [];

        return { evaluators, agents, monitors };
      }),

      /**
       * Archives the workflow and everything downstream of it in one
       * transaction: linked evaluators and agents are archived, and the
       * monitors those evaluators back are deleted outright — a monitor with
       * no evaluator has nothing to run.
       */
      cascadeArchive: policy("workflows:delete")(
        procedure.input(workflowApiArchiveInputSchema),
      ).mutation(async ({ ctx, input }) => {
        return await ports.cascadeArchiveWorkflow(ctx, {
          projectId: input.projectId,
          workflowId: input.workflowId,
          unarchive: input.unarchive,
        });
      }),

      archive: policy("workflows:delete")(procedure.input(workflowApiArchiveInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.workflows.archive({
            id: input.workflowId,
            projectId: input.projectId,
            unarchive: input.unarchive,
          });
        },
      ),

      /**
       * A short commit message for the change between two graphs.
       *
       * Both graphs are normalised the same way first — local configuration
       * stripped, keys sorted — so a reordering or a transient runtime state
       * reads as no change at all and never reaches a model.
       */
      generateCommitMessage: policy("workflows:update")(
        procedure.input(workflowApiGenerateCommitMessageInputSchema),
      ).mutation(async ({ ctx, input }): Promise<WorkflowApiGenerateCommitMessageOutput> => {
        const previousDsl = comparableDsl(input.prevDsl);
        const nextDsl = comparableDsl(input.newDsl);

        if (previousDsl === nextDsl) {
          return "no changes";
        }

        return await ports.generateCommitMessage(ctx, {
          projectId: input.projectId,
          previousDsl,
          nextDsl,
        });
      }),
    });
  }
}
