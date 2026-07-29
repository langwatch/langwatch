/**
 * tRPC router for AI Gateway virtual keys.
 *
 * Org-scoped (iter 110). Every procedure takes `organizationId` as the
 * tenant key and gates on `virtualKeys:view` / `virtualKeys:manage` /
 * `virtualKeys:rotate` / `virtualKeys:delete` at the organization
 * scope. Per-scope enforcement (a caller can only create a VK at
 * scopes where they hold `virtualKeys:manage`) lives in the service
 * layer via `assertCanManageScopes`. Tier 2 lane A1 of the
 * VK + ModelProvider refactor.
 *
 * Reads return the camel-cased DTO (`toVirtualKeyCamelDto`) — the
 * `scopes[]` array + `routingPolicyId` carry the new eligible-provider
 * derivation; the legacy `providerCredentialIds`/`providerChain`
 * fields are no longer surfaced.
 */

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Session } from "~/server/auth";
import { resolveApplicableBudgetsForDraftKey } from "~/server/gateway/applicableBudgets.service";
import {
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
  GatewaySpendUnavailableError,
  GuardrailAttachForbiddenError,
  VirtualKeyNotFoundError,
} from "~/server/gateway/errors";
import { GatewayUsageService } from "~/server/gateway/usage.service";
import {
  assertCanManageAllScopes,
  assertCanOperateOnAnyScope,
  isVisibleToMembership,
  loadMembershipSet,
} from "~/server/gateway/virtualKey.authz";
import {
  type GuardrailAttachment,
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
} from "~/server/gateway/virtualKey.config";
import { toVirtualKeyCamelDto } from "~/server/gateway/virtualKey.dto";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { startOfCurrentMonthUTC } from "~/server/gateway/virtualKeySpend.clickhouse.repository";
import { scopeAssignmentSchema } from "~/server/scopes/scope.types";
import { authorizeInResolver, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { chRepoOrUndefined, spendRepoOrUndefined } from "./gatewayUsage";

const scopeInputSchema = scopeAssignmentSchema;

const routingModeSchema = z.enum(["NONE", "FALLBACK_ALL", "POLICY"]);

/**
 * The cap a key carries on itself. Only the calendar windows a person
 * reasons about in a drawer: a per-minute cap on one key is an ops knob,
 * not a spending decision, and belongs on the budgets page.
 */
const budgetInputSchema = z.object({
  // A whole decimal number of dollars, strictly positive. String rather
  // than number to survive JSON round-trips without float drift; the
  // regex rejects partial parses ("10abs"), signs, and bare dots.
  limitUsd: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "limitUsd must be a decimal number")
    .refine((v) => Number.parseFloat(v) > 0, {
      message: "limitUsd must be greater than zero",
    }),
  window: z.enum(["DAY", "WEEK", "MONTH"]),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  name: z.string().min(1).max(128).optional(),
});

const idInput = z.object({ organizationId: z.string(), id: z.string() });

/**
 * Resolve the single PROJECT scope a VK is reachable from. Guardrails are
 * project-scoped, so a VK can only attach guardrails from this one
 * project (its trace project). Returns null when the VK has zero or more
 * than one PROJECT scope — neither has a well-defined guardrail surface.
 */
async function resolveVkProjectId(
  prisma: PrismaClient,
  organizationId: string,
  vkId: string | null,
  inputScopes: { scopeType: string; scopeId: string }[] | undefined,
  traceProjectId?: string | null,
): Promise<string | null> {
  let scopes = inputScopes;
  let storedTraceProjectId: string | null = null;
  if (!scopes && vkId) {
    const vk = await prisma.virtualKey.findFirst({
      where: { id: vkId, organizationId },
      select: {
        traceProjectId: true,
        scopes: { select: { scopeType: true, scopeId: true } },
      },
    });
    scopes = vk?.scopes;
    storedTraceProjectId = vk?.traceProjectId ?? null;
  }
  const projectScopes = (scopes ?? []).filter((s) => s.scopeType === "PROJECT");
  if (projectScopes.length === 1) return projectScopes[0]!.scopeId;
  // Guardrails are project-scoped and enforce where traces land, so an
  // org- or team-owned key's guardrail surface is its explicit trace
  // destination.
  return traceProjectId ?? storedTraceProjectId;
}

/**
 * The explicit trace destination must be a project of the key's own
 * organization: it decides where traces (and therefore budget debits)
 * land, and a stray id would route another tenant's costs.
 */
async function assertTraceProjectBelongsToOrg(
  prisma: PrismaClient,
  organizationId: string,
  traceProjectId: string | null | undefined,
): Promise<void> {
  if (!traceProjectId) return;
  const project = await prisma.project.findFirst({
    where: { id: traceProjectId, team: { organizationId } },
    select: { id: true },
  });
  if (!project) {
    throw new GatewayScopeOrgMismatchError("project");
  }
}

/**
 * Every requested scope must belong to the VK's own organization.
 * `assertCanManageAllScopes` only proves the caller controls each scope,
 * not that the scope lives in `organizationId` — without this, a caller
 * with manage rights in org A could submit `organizationId` for org B
 * plus a scope from org A and write a cross-org VK row. ORGANIZATION
 * scopes must equal the org; TEAM/PROJECT scopes must resolve to it.
 */
async function assertScopesBelongToOrg(
  prisma: PrismaClient,
  organizationId: string,
  scopes: { scopeType: string; scopeId: string }[],
): Promise<void> {
  const teamIds = scopes
    .filter((s) => s.scopeType === "TEAM")
    .map((s) => s.scopeId);
  const projectIds = scopes
    .filter((s) => s.scopeType === "PROJECT")
    .map((s) => s.scopeId);

  for (const s of scopes) {
    if (s.scopeType === "ORGANIZATION" && s.scopeId !== organizationId) {
      throw new GatewayScopeOrgMismatchError("organization");
    }
  }

  if (teamIds.length > 0) {
    const found = await prisma.team.findMany({
      where: { id: { in: teamIds }, organizationId },
      select: { id: true },
    });
    const foundIds = new Set(found.map((t) => t.id));
    for (const id of teamIds) {
      if (!foundIds.has(id)) {
        throw new GatewayScopeOrgMismatchError("team");
      }
    }
  }

  if (projectIds.length > 0) {
    const found = await prisma.project.findMany({
      where: { id: { in: projectIds }, team: { organizationId } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((p) => p.id));
    for (const id of projectIds) {
      if (!foundIds.has(id)) {
        throw new GatewayScopeOrgMismatchError("project");
      }
    }
  }
}

/**
 * Validate guardrail attachments before handing off to the service:
 *   - every referenced guardrail must belong to the VK's own project
 *     (guardrails are project-scoped; the materialiser only ships the
 *     VK trace-project's guardrails) — else BAD_REQUEST
 *     `guardrail_project_mismatch`.
 *   - the actor must hold `gatewayGuardrails:attach` on that project —
 *     else FORBIDDEN `missing_perm:gatewayGuardrails:attach`.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 *       — @cross-project + @rbac scenarios.
 */
async function assertGuardrailAttachmentsAllowed(
  ctx: { prisma: PrismaClient; session: Session | null },
  vkProjectId: string | null,
  attachments: GuardrailAttachment[] | undefined,
): Promise<void> {
  const referencedIds = Array.from(
    new Set((attachments ?? []).flatMap((a) => a.guardrailIds)),
  );
  if (referencedIds.length === 0) return;

  if (!vkProjectId) {
    throw new GatewayGuardrailProjectMismatchError();
  }

  // Scope the lookup to the VK's own project. Any referenced guardrail
  // that belongs to a different project (or doesn't exist) is simply
  // absent from the result, so the membership check below rejects it.
  // Scoping by projectId also satisfies the multitenancy middleware.
  const rows = await ctx.prisma.gatewayGuardrail.findMany({
    where: { id: { in: referencedIds }, projectId: vkProjectId },
    select: { id: true },
  });
  const foundIds = new Set(rows.map((r) => r.id));

  for (const id of referencedIds) {
    if (!foundIds.has(id)) {
      throw new GatewayGuardrailProjectMismatchError();
    }
  }

  const allowed = await hasProjectPermission(
    ctx,
    vkProjectId,
    "gatewayGuardrails:attach",
  );
  if (!allowed) {
    throw new GuardrailAttachForbiddenError();
  }
}

export const virtualKeysRouter = createTRPCRouter({
  // Visibility is membership-based, not permission-based: a caller sees a
  // VK when one of its scopes intersects their membership set (org member
  // sees org-scoped keys, team member sees that team's keys). The
  // data-dependent membership filter runs in the resolver, so the builder's
  // fail-closed gate is satisfied by authorizeInResolver rather than a
  // coarse org-wide virtualKeys:view check that a plain member lacks.
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const keys = await service.getAll(input.organizationId);
      return keys
        .filter((vk) => isVisibleToMembership(membership, vk.scopes))
        .map(toVirtualKeyCamelDto);
    }),

  get: protectedProcedure
    .input(idInput)
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const vk = await service.getById(input.id, input.organizationId);
      // A key the caller can't see is indistinguishable from one that
      // doesn't exist — same NOT_FOUND, no existence leak.
      if (!vk) {
        throw new VirtualKeyNotFoundError();
      }
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      if (!isVisibleToMembership(membership, vk.scopes)) {
        throw new VirtualKeyNotFoundError();
      }
      return toVirtualKeyCamelDto(vk);
    }),

  /**
   * Spend per key for the current calendar month, for the keys the caller
   * can see. Reads the cost path (`trace_summaries`), the same source the
   * Usage tab reads, so the number in the table matches the page a click
   * on it lands on.
   */
  spendThisMonth: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      // Without the ClickHouse spend source there is no number to report.
      // Failing loudly lets the column render "unavailable" instead of a
      // confident $0.00 that cannot be told apart from a zero-spend key.
      const spendRepo = spendRepoOrUndefined();
      if (!spendRepo) {
        throw new GatewaySpendUnavailableError();
      }
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const keys = (await service.getAll(input.organizationId)).filter((vk) =>
        isVisibleToMembership(membership, vk.scopes),
      );
      const now = new Date();
      const usage = GatewayUsageService.create({
        prisma: ctx.prisma,
        chRepo: undefined,
        spendRepo,
      });
      const spend = await usage.spendByVirtualKey({
        organizationId: input.organizationId,
        virtualKeyIds: keys.map((k) => k.id),
        window: { fromDate: startOfCurrentMonthUTC(now), toDate: now },
      });
      // Every visible key gets a row. With the spend source present, a
      // missing entry means the key genuinely spent nothing, so zero is
      // the honest render rather than an ambiguous blank.
      return keys.map((k) => ({
        virtualKeyId: k.id,
        spentUsd: spend.get(k.id)?.spentUsd ?? "0",
        requests: spend.get(k.id)?.requests ?? 0,
      }));
    }),

  /**
   * Every budget that would constrain this key: the "already applies"
   * list under the budget field in the create / edit drawer. Takes a draft
   * (the scopes the creator has picked, no key row yet) so the list is
   * answerable before the key exists.
   */
  applicableBudgets: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        virtualKeyId: z.string().nullable().optional(),
        scopes: z.array(scopeInputSchema).min(1),
        traceProjectId: z.string().nullable().optional(),
        principalUserId: z.string().nullable().optional(),
      }),
    )
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      // Authorization first, before any budget data is touched. This
      // resolver answers with budget names, limits, live spend and (for
      // a principal) their name, so knowing an organization id must not
      // be enough to call it.
      //
      // For an existing key (edit drawer): the caller must be able to
      // SEE the key (the list/get visibility rule), and resolution binds
      // to the key's STORED ownership. The caller-supplied scopes,
      // destination and principal are ignored: honoring them would let
      // anyone who can see an org-wide key read a sibling team's budget
      // names and spend by injecting that team's scope into the input.
      if (input.virtualKeyId) {
        const vk = await ctx.prisma.virtualKey.findFirst({
          where: {
            id: input.virtualKeyId,
            organizationId: input.organizationId,
          },
          select: {
            id: true,
            traceProjectId: true,
            principalUserId: true,
            scopes: { select: { scopeType: true, scopeId: true } },
          },
        });
        if (!vk) {
          throw new VirtualKeyNotFoundError();
        }
        const membership = await loadMembershipSet(
          ctx.prisma,
          input.organizationId,
          ctx.session.user.id,
        );
        if (
          !isVisibleToMembership(
            membership,
            vk.scopes as {
              scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
              scopeId: string;
            }[],
          )
        ) {
          throw new VirtualKeyNotFoundError();
        }
        return resolveApplicableBudgetsForDraftKey(
          ctx.prisma,
          {
            organizationId: input.organizationId,
            virtualKeyId: vk.id,
            scopes: vk.scopes as {
              scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
              scopeId: string;
            }[],
            traceProjectId: vk.traceProjectId,
            principalUserId: vk.principalUserId,
          },
          chRepoOrUndefined(),
        );
      }
      // For a draft (create drawer): the caller must hold
      // virtualKeys:manage on every draft scope AND on the chosen trace
      // destination, the exact boundary `create` will hold them to when
      // they submit; previewing a target's budgets must not be cheaper
      // than creating a key against it.
      await assertCanManageAllScopes(
        { prisma: ctx.prisma, session: ctx.session },
        input.scopes,
      );
      await assertScopesBelongToOrg(
        ctx.prisma,
        input.organizationId,
        input.scopes,
      );
      await assertTraceProjectBelongsToOrg(
        ctx.prisma,
        input.organizationId,
        input.traceProjectId,
      );
      if (input.traceProjectId) {
        await assertCanManageAllScopes(
          { prisma: ctx.prisma, session: ctx.session },
          [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
        );
      }
      // The principal id is still pinned to the organization: even an
      // authorized caller must not resolve another tenant's rows.
      if (input.principalUserId) {
        const membership = await ctx.prisma.organizationUser.findFirst({
          where: {
            organizationId: input.organizationId,
            userId: input.principalUserId,
          },
          select: { userId: true },
        });
        if (!membership) {
          throw new GatewayScopeOrgMismatchError("user");
        }
      }
      return resolveApplicableBudgetsForDraftKey(
        ctx.prisma,
        {
          organizationId: input.organizationId,
          virtualKeyId: null,
          scopes: input.scopes,
          traceProjectId: input.traceProjectId ?? null,
          principalUserId: input.principalUserId ?? null,
        },
        chRepoOrUndefined(),
      );
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        principalUserId: z.string().nullable().optional(),
        scopes: z.array(scopeInputSchema).min(1),
        traceProjectId: z.string().nullable().optional(),
        routingPolicyId: z.string().nullable().optional(),
        routingMode: routingModeSchema.optional(),
        budget: budgetInputSchema.nullable().optional(),
        config: virtualKeyConfigSchema.partial().optional(),
      }),
    )
    // Per-scope authz (manage on EVERY requested scope) is data-dependent,
    // so it runs in the resolver; authorizeInResolver satisfies the
    // builder's fail-closed permission gate without re-introducing the
    // coarse org-wide check.
    .use(authorizeInResolver)
    .mutation(async ({ ctx, input }) => {
      await assertCanManageAllScopes(
        { prisma: ctx.prisma, session: ctx.session },
        input.scopes,
      );
      await assertScopesBelongToOrg(
        ctx.prisma,
        input.organizationId,
        input.scopes,
      );
      await assertTraceProjectBelongsToOrg(
        ctx.prisma,
        input.organizationId,
        input.traceProjectId,
      );
      // The destination routes traces AND budget debits into that
      // project, so choosing it needs the same manage grant the old
      // PROJECT scope enforced; tenancy alone would let a team manager
      // point a key at a sibling team's project and consume its budget.
      if (input.traceProjectId) {
        await assertCanManageAllScopes(
          { prisma: ctx.prisma, session: ctx.session },
          [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
        );
      }
      const vkProjectId = await resolveVkProjectId(
        ctx.prisma,
        input.organizationId,
        null,
        input.scopes,
        input.traceProjectId ?? null,
      );
      await assertGuardrailAttachmentsAllowed(
        ctx,
        vkProjectId,
        input.config?.guardrailAttachments,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const { virtualKey, secret } = await service.create({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
        principalUserId: input.principalUserId ?? null,
        scopes: input.scopes,
        traceProjectId: input.traceProjectId ?? null,
        routingPolicyId: input.routingPolicyId ?? null,
        routingMode: input.routingMode,
        budget: input.budget ?? null,
        config: input.config,
        actorUserId: ctx.session.user.id,
      });
      return { virtualKey: toVirtualKeyCamelDto(virtualKey), secret };
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        scopes: z.array(scopeInputSchema).min(1).optional(),
        traceProjectId: z.string().nullable().optional(),
        routingPolicyId: z.string().nullable().optional(),
        routingMode: routingModeSchema.optional(),
        budget: budgetInputSchema.nullable().optional(),
        config: virtualKeyConfigSchema.partial().optional(),
      }),
    )
    .use(authorizeInResolver)
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const existing = await service.getById(input.id, input.organizationId);
      if (!existing) {
        throw new VirtualKeyNotFoundError();
      }
      // Mutating an existing key needs virtualKeys:update on one of the
      // scopes it already lives in.
      await assertCanOperateOnAnyScope(
        { prisma: ctx.prisma, session: ctx.session },
        existing.scopes,
        "virtualKeys:update",
      );
      // Re-scoping additionally needs manage on every NEW scope, so a key
      // can't be moved into a scope the caller doesn't control.
      if (input.scopes) {
        await assertCanManageAllScopes(
          { prisma: ctx.prisma, session: ctx.session },
          input.scopes,
        );
        await assertScopesBelongToOrg(
          ctx.prisma,
          input.organizationId,
          input.scopes,
        );
      }
      if (input.traceProjectId !== undefined) {
        await assertTraceProjectBelongsToOrg(
          ctx.prisma,
          input.organizationId,
          input.traceProjectId,
        );
        // Re-pointing the destination is the same decision as choosing
        // it at create: it needs manage on the target project.
        if (input.traceProjectId) {
          await assertCanManageAllScopes(
            { prisma: ctx.prisma, session: ctx.session },
            [{ scopeType: "PROJECT", scopeId: input.traceProjectId }],
          );
        }
      }
      const vkProjectId = await resolveVkProjectId(
        ctx.prisma,
        input.organizationId,
        input.id,
        input.scopes,
        input.traceProjectId !== undefined
          ? input.traceProjectId
          : existing.traceProjectId,
      );
      // Newly-submitted attachments are always validated. When the caller
      // is ALSO changing scopes (a possible project move) but did not
      // re-send config, revalidate the existing attachments against the
      // new project so a stale cross-project attachment can't survive the
      // move. A plain metadata update (no scope change, no new
      // attachments) must not re-touch existing attachments, otherwise
      // renaming a VK would demand gatewayGuardrails:attach.
      const attachmentsToCheck =
        input.config?.guardrailAttachments ??
        (input.scopes !== undefined
          ? parseVirtualKeyConfig(existing.config).guardrailAttachments
          : undefined);
      await assertGuardrailAttachmentsAllowed(
        ctx,
        vkProjectId,
        attachmentsToCheck,
      );
      const updated = await service.update({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        scopes: input.scopes,
        traceProjectId: input.traceProjectId,
        routingPolicyId: input.routingPolicyId,
        routingMode: input.routingMode,
        budget: input.budget,
        config: input.config,
        actorUserId: ctx.session.user.id,
      });
      return toVirtualKeyCamelDto(updated);
    }),

  rotate: protectedProcedure
    .input(idInput)
    .use(authorizeInResolver)
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const existing = await service.getById(input.id, input.organizationId);
      if (!existing) {
        throw new VirtualKeyNotFoundError();
      }
      await assertCanOperateOnAnyScope(
        { prisma: ctx.prisma, session: ctx.session },
        existing.scopes,
        "virtualKeys:rotate",
      );
      const { virtualKey, secret } = await service.rotate({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
      });
      return { virtualKey: toVirtualKeyCamelDto(virtualKey), secret };
    }),

  revoke: protectedProcedure
    .input(idInput)
    .use(authorizeInResolver)
    .mutation(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const existing = await service.getById(input.id, input.organizationId);
      if (!existing) {
        throw new VirtualKeyNotFoundError();
      }
      await assertCanOperateOnAnyScope(
        { prisma: ctx.prisma, session: ctx.session },
        existing.scopes,
        "virtualKeys:delete",
      );
      const updated = await service.revoke({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
      });
      return toVirtualKeyCamelDto(updated);
    }),
});
