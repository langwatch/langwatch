/**
 * The per-project Langy egress allow-list over the process's tRPC transport
 * (ADR-076).
 *
 *   get — the current allow-list for the settings editor. `null` means the
 *         project is in monitor-only mode (watch, never block).
 *   set — replaces the allow-list. An empty array clears it back to
 *         monitor-only. Gated on `langy:manage` — this is a project network
 *         policy, not per-user state.
 *
 * The enforcement path is the credentials envelope + the agent's egress
 * adapter (see LangyCredentialService.tryGetEgressAllowlist and
 * app-layer/langyagent/adapters/egress/adapter.go). This surface is only how a
 * customer reads and sets the value; a change takes effect on the
 * conversation's next turn (the worker recycles when its egress signature
 * changes).
 *
 * Both procedures sit behind the authoritative Langy internal-only gate as well
 * as their `langy:*` permission — this is Langy config, so it stays dark for
 * accounts that don't have Langy.
 *
 * They also refuse the demo project, mirroring the conversation surface. These
 * used to read `project:view` / `project:update`, and `project:view` is granted
 * to EVERY authenticated user on the demo project (DEMO_VIEW_PERMISSIONS), so
 * `get` was exposing the demo project's egress allow-list — the set of hosts
 * Langy's sandbox may reach — to anyone with an account. `langy:*` is not
 * demo-granted, and the explicit refusal keeps it that way if that ever changes.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { langyEgressAllowlistSchema } from "@langwatch/langy-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { LangyApp } from "#app/langy.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * The same slice the conversation door takes, and the same {@link LangyApp}
 * object: one application, two doors. Before it, this door declared
 * `Readonly<{ langy: LangyService }>` and the conversation door declared a
 * wider bag of its own, and neither could reach the other's.
 */
export type LangyEgressTrpcContext = Readonly<{
  app: Readonly<{ langy: LangyApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type LangyEgressTrpcProcedures<
  TContext extends LangyEgressTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization, audit,
   * demo-refusal and Langy-rollout policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capabilities this transport needs that are not Langy's own. */
export type LangyEgressTrpcPorts = Readonly<{
  /** The process's audit trail. */
  recordAudit(
    entry: Readonly<{
      userId: string;
      projectId: string;
      action: string;
      metadata: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<void>;
}>;

const egressProjectSchema = z.object({ projectId: z.string() });

const egressSetSchema = z.object({
  projectId: z.string(),
  allowlist: langyEgressAllowlistSchema,
});

/** Installs the complete `langyEgress.*` tRPC surface on a process-owned root. */
export class LangyEgressTrpcApi {
  static create<
    TContext extends LangyEgressTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LangyEgressTrpcProcedures<TContext, TOptions, TRoot>,
    ports: LangyEgressTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      get: policy("langy:view")(procedure.input(egressProjectSchema)).query(
        // Monitor-only is decided on the application, not here: the editor
        // renders an empty list + the "leave empty to watch without blocking"
        // hint when `enforcing` is false.
        async ({ ctx, input }) =>
          await ctx.app.langy.egressAllowlist({ projectId: input.projectId }),
      ),

      set: policy("langy:manage")(procedure.input(egressSetSchema)).mutation(
        async ({ ctx, input }) => {
          const saved = await ctx.app.langy.setEgressAllowlist({
            projectId: input.projectId,
            allowlist: input.allowlist,
          });
          await ports.recordAudit({
            userId: ctx.actor().id,
            projectId: input.projectId,
            action: "langy.egress.setAllowlist",
            // The host list travels further than the UI (SIEM, tickets); log only
            // its shape, mirroring how the conversation surface logs the model
            // allow-list.
            metadata: { entryCount: saved.allowlist.length, enforcing: saved.enforcing },
          });
          return saved;
        },
      ),
    });
  }
}
