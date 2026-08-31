/**
 * The scoped privacy rules, over the process's tRPC transport.
 *
 * Three procedures, and they are the settings page: read the snapshot a
 * project's privacy screen renders, write the rule at one (scope,
 * personalOnly) target, and remove it so the next tier applies again.
 *
 * The feature owns the WORDS on this wire — the four scope tiers and the
 * durable configuration schema come from `@langwatch/data-privacy-contract`,
 * the same parser the repository validates stored rows through, so the shape a
 * browser may send and the shape the table may hold cannot drift apart. It
 * owns the two failures a caller can act on as well: a scope target that does
 * not exist is `NOT_FOUND`, a configuration the service refuses is
 * `BAD_REQUEST`, and both arrive as this feature's own error classes.
 *
 * What it does NOT own is who may write. The snapshot is assembled from four
 * other verticals' storage — organizations, departments, teams and groups —
 * and filtered by the caller's permissions at each tier; the write is
 * authorized by anchoring the target scope to the project's organization and
 * then probing the permission that tier demands. Both are the application's
 * reach and neither could be answered inside this package, so all three
 * procedures delegate through {@link DataPrivacyTrpcPorts}, and the two write
 * declarations arrive as decorators the process built — the sentence naming
 * what enforces each field belongs where those assertions live.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  dataPrivacyConfigSchema,
  DATA_PRIVACY_SCOPE_TYPES,
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
  type DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * Nothing, stated rather than left implicit.
 *
 * Every procedure reads its target from validated input and its answer from a
 * port, so this surface places no requirement on the process's request
 * context. A later read that needs one is a change to this line, and to every
 * mount that has to satisfy it.
 */
export type DataPrivacyTrpcContext = object;

/** One procedure, wrapped in the process's policy chain. */
type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type DataPrivacyTrpcProcedures<
  TContext extends DataPrivacyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied AFTER this feature's own input parser rather than composed ahead
   * of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /**
   * The same chain around the process's own resolver-authorized declaration
   * for a rule WRITE.
   *
   * A ready-made decorator rather than a declaration this package writes,
   * because the declaration's job is to name what enforces the project id, and
   * what enforces it is the pair of assertions behind
   * {@link DataPrivacyTrpcPorts.setForScope}. That sentence belongs where those
   * assertions live; restating it here would be a copy that can go stale
   * silently, and the declaration sweep reads it as a claim.
   */
  scopeWritePolicy: ProcedureDecorator;
  /** The same, for a rule REMOVAL — a different act, so a different claim. */
  scopeRemovalPolicy: ProcedureDecorator;
}>;

/**
 * The process capabilities this transport needs that are not the privacy
 * rules' own.
 *
 * Generic over the snapshot and the written rule: a tRPC procedure publishes
 * what its handler returns, so narrowing either to a shape stated here is
 * narrowing what the browser is handed.
 */
export type DataPrivacyTrpcPorts<TSnapshot, TPolicy> = Readonly<{
  /**
   * The privacy settings snapshot for one project: the effective resolved
   * policy, the rules the caller may read grouped by scope, and the scopes the
   * caller may write. Assembled across the organization, department, team and
   * group storage this package does not reach, and filtered by the caller's
   * permission at each tier — which is why the read gate below is only
   * `project:view` and the snapshot itself decides what it returns.
   */
  getSnapshot(
    ctx: DataPrivacyTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<TSnapshot>;
  /**
   * Writes the rule at one target, having first anchored the scope to the
   * project's organization and authorized the write at that scope's own tier.
   *
   * Throws {@link ScopeTargetNotFoundError} when the target does not exist and
   * {@link InvalidDataPrivacyConfigError} when the service refuses the
   * configuration; both are answered below. Any other failure is the process's
   * and degrades to the generic unknown plus a trace id.
   */
  setForScope(
    ctx: DataPrivacyTrpcContext,
    input: Readonly<{
      projectId: string;
      scope: DataPrivacyScope;
      personalOnly: boolean;
      config: DataPrivacyConfig;
    }>,
  ): Promise<TPolicy>;
  /**
   * Removes the rule at one target, authorized the same way. Its failures are
   * not translated: this verb has never answered `NOT_FOUND` for a missing
   * target, and every one of its refusals is the process's.
   */
  removeForScope(
    ctx: DataPrivacyTrpcContext,
    input: Readonly<{
      projectId: string;
      scope: DataPrivacyScope;
      personalOnly: boolean;
    }>,
  ): Promise<void>;
}>;

/** The (tier, id) pair a rule hangs on, in the tiers the contract enumerates. */
const scopeInputSchema = z.object({
  scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
  scopeId: z.string().min(1),
});

const projectInputSchema = z.object({ projectId: z.string() });

const setForScopeInputSchema = z.object({
  projectId: z.string(),
  scope: scopeInputSchema,
  personalOnly: z.boolean(),
  config: dataPrivacyConfigSchema,
});

const removeForScopeInputSchema = z.object({
  projectId: z.string(),
  scope: scopeInputSchema,
  personalOnly: z.boolean(),
});

/**
 * The two refusals a WRITE can answer with, as their transport codes.
 *
 * Anything else is rethrown untouched: an unrecognised failure is not this
 * surface's to name, and dressing one up would promise the caller an action
 * they do not have. Removal deliberately does not go through here — it never
 * translated either failure, and a removal that starts answering `NOT_FOUND`
 * is a change to what its callers see rather than a tidy-up.
 */
async function answering<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ScopeTargetNotFoundError) {
      throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    }
    if (error instanceof InvalidDataPrivacyConfigError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

/** Installs the complete `dataPrivacy.*` tRPC surface on a process root. */
export class DataPrivacyTrpcApi {
  static create<
    TContext extends DataPrivacyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TSnapshot,
    TPolicy,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: DataPrivacyTrpcProcedures<TContext, TOptions, TRoot>,
    ports: DataPrivacyTrpcPorts<TSnapshot, TPolicy>,
  ) {
    const { protected: procedure, policy, scopeWritePolicy, scopeRemovalPolicy } = procedures;

    return trpc.router({
      /**
       * `project:view`: reading the screen is a project read. The snapshot
       * filters the rules and the writable scopes it returns by what the
       * caller may actually see, so a wider gate here would not widen the
       * answer.
       */
      getSnapshot: policy("project:view")(procedure.input(projectInputSchema)).query(
        ({ ctx, input }) => ports.getSnapshot(ctx, { projectId: input.projectId }),
      ),

      /**
       * Authorized on the TARGET scope, not on the project the request names —
       * ORGANIZATION and DEPARTMENT need `organization:manage`, TEAM needs
       * `team:manage`, PROJECT needs `project:update` — so a project member
       * cannot push a rule up to the organization.
       */
      setForScope: scopeWritePolicy(procedure.input(setForScopeInputSchema)).mutation(
        ({ ctx, input }) =>
          answering(() =>
            ports.setForScope(ctx, {
              projectId: input.projectId,
              scope: input.scope,
              personalOnly: input.personalOnly,
              config: input.config,
            }),
          ),
      ),

      /** Removes the rule at one target; the next tier up then applies. */
      removeForScope: scopeRemovalPolicy(procedure.input(removeForScopeInputSchema)).mutation(
        ({ ctx, input }) =>
          ports.removeForScope(ctx, {
            projectId: input.projectId,
            scope: input.scope,
            personalOnly: input.personalOnly,
          }),
      ),
    });
  }
}
