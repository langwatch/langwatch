/**
 * Per-project Langy egress allow-list over tRPC (ADR-076). `get`/`set` gated
 * on `langy:manage`, refuse the demo project (unlike demo-granted
 * `project:view`). This surface only reads/writes; enforcement is elsewhere.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  langyEgressStateSchema,
  langyEgressGetInputSchema,
  langyEgressSetInputSchema,
} from "@langwatch/langy-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { LangyApp } from "#app/langy.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 * Same slice and same {@link LangyApp} object the conversation door takes —
 * one application, two doors.
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
   * The process's cross-cutting policy for one declared permission. Applied
   * AFTER `.input()`: the authz check reads its scope id from validated
   * input, and tRPC runs middlewares in add order.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** Whether the chain checks every answer against its declared output schema. */
  validateOutput: boolean;
}>;

/**
 * A value the audit trail can store. The trail's column is JSON, so the port
 * says JSON: `unknown` would let a `Date`, a `Map` or a `bigint` past the
 * declaration and into a sink that cannot hold one.
 */
type AuditedJson =
  | string
  | number
  | boolean
  | null
  | AuditedJson[]
  | { [key: string]: AuditedJson };

/** The process capabilities this transport needs that are not Langy's own. */
export type LangyEgressTrpcPorts = Readonly<{
  /**
   * The process's audit trail. The payload rides `metadata`, which is the
   * column this action has always been recorded under.
   */
  recordAudit(
    entry: Readonly<{
      userId: string;
      projectId: string;
      action: string;
      metadata: Readonly<Record<string, AuditedJson>>;
    }>,
  ): Promise<void>;
}>;

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
    return createTrpcService({
      root: trpc,
      procedures,
      validateOutput: procedures.validateOutput,
    })
      .query("get", (p) =>
        p
          .withInput(langyEgressGetInputSchema)
          .withOutput(langyEgressStateSchema)
          .withPermission("langy:view")
          // Monitor-only is decided on the application, not here: the editor
          // renders an empty list + the "leave empty to watch without blocking"
          // hint when `enforcing` is false.
          .handle(
            async ({ ctx, input }) =>
              await ctx.app.langy.egressAllowlist({ projectId: input.projectId }),
          ),
      )
      .mutation("set", (p) =>
        p
          .withInput(langyEgressSetInputSchema)
          .withOutput(langyEgressStateSchema)
          .withPermission("langy:manage")
          .handle(async ({ ctx, input }) => {
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
          }),
      )
      .build();
  }
}
