/**
 * Cross-cutting governance read-side procedures — the surfaces that don't fit
 * under a more focused router.
 *
 * Four surfaces live here:
 *   - `setupState` — persona-detection signal for nav promotion
 *   - `ocsfExport` — cursor-paginated SIEM forwarding pull
 *   - `recordWorkspaceView` — admin drill-in audit + OCSF mirror
 *   - `quarantineFillStats` — rate the admin UI polls for the quarantine warning
 *
 * `resolveHome` and `resolveActorPersonalProject` stay on the app router for
 * now: both reach `ctx.prisma` and compose several other feature services
 * (feature flags, organizations, users, usage stats). They will move once
 * their data-gathering is behind a `PersonaHomeApp` / `ActorResolutionApp`
 * seam.
 *
 * Transport only: input parsing, delegation, wire shape. All refusal types
 * on the governance service are `HandledError`, so no bespoke translator is
 * needed here.
 *
 * Specs:
 *   - specs/ai-gateway/governance/feature-flag-gating.feature
 *   - specs/ai-gateway/governance/siem-export.feature
 *   - specs/ai-gateway/governance/admin-trace-access.feature
 *   - specs/ai-gateway/governance/ingestion-attribution.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

export type GovernanceTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type GovernanceTrpcProcedures<
  TContext extends GovernanceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
  /** Refuses off-plan callers with the `OCSF_EXPORT` refusal copy. */
  ocsfExportPlanGate: ProcedureDecorator;
}>;

const organizationScope = z.object({ organizationId: z.string() });

const ocsfExportSchema = organizationScope.extend({
  /** Lower bound paired with sinceEventId — return events after this watermark. */
  sinceMs: z.number().int().nonnegative().optional(),
  /** EventId watermark paired with sinceMs; from the prior page's `nextCursorCompound`. */
  sinceEventId: z.string().optional(),
  /** Page size — soft cap at 1000 to keep responses bounded. */
  limit: z.number().int().min(1).max(1000).default(500),
});

const recordWorkspaceViewSchema = organizationScope.extend({
  targetTeamId: z.string(),
  kind: z.enum(["personal", "team"]),
  workspaceLabel: z.string().max(256).optional(),
});

const quarantineFillStatsSchema = organizationScope.extend({
  windowSeconds: z
    .number()
    .int()
    .min(10)
    .max(3600)
    .default(QUARANTINE_DEFAULT_WINDOW_SECONDS),
  threshold: z.number().int().min(1).default(QUARANTINE_DEFAULT_THRESHOLD),
});

/** Installs the cross-cutting `governance.*` tRPC surface on a process root. */
export class GovernanceTrpcApi {
  static create<
    TContext extends GovernanceTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GovernanceTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, ocsfExportPlanGate } = procedures;

    return trpc.router({
      /**
       * Read-only governance setup-state summary. `governanceActive` is the
       * persona-detection signal: UI nav promotes /governance only when this
       * is true AND the user has `governance:view`. Non-admins never call
       * this; the app router's `resolveHome` uses the service directly so
       * identity-routing for non-admins still works.
       */
      setupState: policy("governance:view")(procedure.input(organizationScope)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.resolveSetupState(input.organizationId),
      ),

      /**
       * SIEM forwarding pull — cursor-paginated OCSF v1.1 / OWASP AOS events
       * for security teams. Read-only, paginated by EventTime, returns rows
       * since cursor T. Empty-state safe: returns `events=[]` +
       * `nextCursor=null` when the org has no Gov project or no events past
       * the cursor. Enterprise-only.
       */
      ocsfExport: policy("complianceExport:view")(
        ocsfExportPlanGate(procedure.input(ocsfExportSchema)),
      ).query(async ({ ctx, input }) =>
        ctx.app.governance.ocsfList({
          organizationId: input.organizationId,
          sinceMs: input.sinceMs ?? 0,
          sinceEventId: input.sinceEventId,
          limit: input.limit,
        }),
      ),

      /**
       * Records the admin's bird's-eye drill-in into a target personal or
       * team workspace. Idempotent within a 5-minute window so the
       * layout-level `adminViewingAs` detection fires on every page paint
       * without flooding the audit log — the service absorbs extra calls.
       * Self-views short-circuit at the service with no audit row written.
       */
      recordWorkspaceView: policy("governance:view")(
        procedure.input(recordWorkspaceViewSchema),
      ).mutation(async ({ ctx, input }) =>
        ctx.app.governance.adminWorkspaceRecordView({
          actorUserId: ctx.actor().id,
          organizationId: input.organizationId,
          targetTeamId: input.targetTeamId,
          kind: input.kind,
          workspaceLabel: input.workspaceLabel,
        }),
      ),

      /**
       * Current quarantine-fill rate for the org's hidden Gov project. The
       * admin UI on /governance polls this and surfaces a warning Alert when
       * `exceeded` is true. Per-source breakdown lets the admin pin which
       * IngestionSource is misconfigured without a separate drill-down.
       */
      quarantineFillStats: policy("governance:view")(
        procedure.input(quarantineFillStatsSchema),
      ).query(async ({ ctx, input }) =>
        ctx.app.governance.quarantineFillEvaluate({
          organizationId: input.organizationId,
          windowSeconds: input.windowSeconds,
          threshold: input.threshold,
        }),
      ),
    });
  }
}
