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
 * A fifth, `resolveActorPersonalProject`, answers the admin drill-in link. The
 * rule is {@link GovernanceApp.findActorWorkspace}; only the actor
 * token's lookup stays a port, because which columns carry an actor identity
 * is the process's fact rather than this feature's.
 *
 * `resolveHome` stays on the app router. Its decision already lives in this
 * feature's contract (`PersonaHomeResolverService`); what is left there is the
 * gathering of seven signals owned by six different features — governance
 * setup state, the project list, the plan, the permission engine, the feature
 * flags, the member's pin and the organization's declared intent — and no one
 * package owns that composition. Handing it here would mean a port per signal,
 * which is the same code with an interface stapled to it.
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
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  governanceActorWorkspaceSchema,
  governanceOcsfExportPageSchema,
  governanceSetupStateSchema,
  quarantineFillStatsSchema as quarantineFillStatsOutputSchema,
  recordWorkspaceViewResultSchema,
  type GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { GovernanceApp } from "#app/governance.app";

export type GovernanceTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceApi; governanceApp: GovernanceApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type GovernanceTrpcProcedures<
  TContext extends GovernanceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** Refuses off-plan callers with the `OCSF_EXPORT` refusal copy. */
  ocsfExportPlanGate: TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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

const resolveActorPersonalProjectSchema = organizationScope.extend({
  /** Email or User id stamped on spans as the actor identity. */
  actor: z.string().min(1).max(512),
});

const quarantineFillStatsSchema = organizationScope.extend({
  windowSeconds: z.number().int().min(10).max(3600).default(QUARANTINE_DEFAULT_WINDOW_SECONDS),
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
    const { protected: procedure, policy, ocsfExportPlanGate, validateOutput } = procedures;
    const complianceExportViewer = policy("complianceExport:view");

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("setupState", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(governanceSetupStateSchema)
          .withPermission("governance:view")
          /**
           * Read-only governance setup-state summary. `governanceActive` is the
           * persona-detection signal: UI nav promotes /governance only when this
           * is true AND the user has `governance:view`. Non-admins never call
           * this; the app router's `resolveHome` uses the service directly so
           * identity-routing for non-admins still works.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.resolveSetupState(input.organizationId),
          ),
      )
      .query("ocsfExport", (p) =>
        p
          .withInput(ocsfExportSchema)
          .withOutput(governanceOcsfExportPageSchema)
          .withCustomPermission(
            // The permission first, the plan gate second, exactly as the
            // hand-built chain composed them: a caller who may not export at
            // all is refused before the answer names which plan they are on.
            (built) => complianceExportViewer(ocsfExportPlanGate(built)),
            "complianceExport:view, then the plan gate that carries the OCSF_EXPORT refusal copy",
          )
          /**
           * SIEM forwarding pull — cursor-paginated OCSF v1.1 / OWASP AOS
           * events for security teams. Read-only, paginated by EventTime,
           * answers rows since cursor T. Empty-state safe: answers `events=[]`
           * and `nextCursor=null` when the organization has no governance
           * project or no events past the cursor. Enterprise-only.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.ocsfList({
              organizationId: input.organizationId,
              sinceMs: input.sinceMs ?? 0,
              sinceEventId: input.sinceEventId,
              limit: input.limit,
            }),
          ),
      )
      .mutation("recordWorkspaceView", (p) =>
        p
          .withInput(recordWorkspaceViewSchema)
          .withOutput(recordWorkspaceViewResultSchema)
          .withPermission("governance:view")
          /**
           * Records the admin's bird's-eye drill-in into a target personal or
           * team workspace. Idempotent within a 5-minute window so the
           * layout-level `adminViewingAs` detection fires on every page paint
           * without flooding the audit log — the service absorbs extra calls.
           * Self-views short-circuit at the service with no audit row written.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.adminWorkspaceRecordView({
              actorUserId: ctx.actor().id,
              organizationId: input.organizationId,
              targetTeamId: input.targetTeamId,
              kind: input.kind,
              workspaceLabel: input.workspaceLabel,
            }),
          ),
      )
      .query("quarantineFillStats", (p) =>
        p
          .withInput(quarantineFillStatsSchema)
          .withOutput(quarantineFillStatsOutputSchema)
          .withPermission("governance:view")
          /**
           * Current quarantine-fill rate for the organization's hidden
           * governance project. The admin UI on /governance polls this and
           * surfaces a warning when `exceeded` is true. The per-source
           * breakdown lets an admin pin which IngestionSource is misconfigured
           * without a separate drill-down.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.quarantineFillEvaluate({
              organizationId: input.organizationId,
              windowSeconds: input.windowSeconds,
              threshold: input.threshold,
            }),
          ),
      )
      .query("resolveActorPersonalProject", (p) =>
        p
          .withInput(resolveActorPersonalProjectSchema)
          .withOutput(governanceActorWorkspaceSchema.nullable())
          .withPermission("governance:view")
          /**
           * Resolves a ClickHouse-side `actor` token to that person's personal
           * workspace inside the organization — the bird's-eye
           * `/governance/users/[id]` page's "View their workspace" link.
           *
           * Null covers every miss: the token names nobody, the person it names
           * is not in this organization, or they have no personal workspace
           * yet. The three stay indistinguishable so the answer never
           * enumerates who exists.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governanceApp.tryResolveActorWorkspace({
              organizationId: input.organizationId,
              actor: input.actor,
            }),
          ),
      )
      .build();
  }
}
