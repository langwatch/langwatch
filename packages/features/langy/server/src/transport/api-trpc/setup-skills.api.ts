/**
 * The setup instructions the empty states copy for a coding agent.
 *
 * The bodies are ~100 kB of markdown, so they stay on the server and reach the
 * browser only when a reader opens a setup menu. The input carries no
 * credentials: a tRPC query is a GET with its input in the URL, and the browser
 * already holds the minted token, so it puts the keys above the body itself.
 *
 * It is Langy's surface because the CATALOGUE is Langy's — the bodies are the
 * compiled skills the Langy image ships — even though the menus that copy them
 * live on the trace and dataset empty states.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { NotFoundError } from "@langwatch/handled-error";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { isSetupSkillId, setupSkillBody } from "../../services/setup-skills.service";

/**
 * The surface reads nothing off the request beyond the project the permission
 * is checked against, so the context is the empty object every mounted
 * procedure already satisfies.
 */
export type SetupSkillsTrpcContext = Readonly<object>;

type SetupSkillsTrpcProcedures<
  TContext extends SetupSkillsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied AFTER this feature's own input parser rather than composed ahead of
   * it, because the authorization check reads its scope id from the validated
   * input: tRPC runs middlewares in the order they were added, so a check
   * installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** Installs the `setupSkills.*` tRPC surface on a process-owned root. */
export class SetupSkillsTrpcApi {
  static create<
    TContext extends SetupSkillsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SetupSkillsTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getPrompt: policy("project:view")(
        procedure.input(z.object({ projectId: z.string(), skill: z.string() })),
      ).query(({ input }: { input: { projectId: string; skill: string } }) => {
        if (!isSetupSkillId(input.skill)) {
          throw new NotFoundError("not_found", "Setup guide", input.skill);
        }
        return { body: setupSkillBody(input.skill) };
      }),
    });
  }
}
