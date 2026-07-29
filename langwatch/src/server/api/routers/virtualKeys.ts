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
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Session } from "~/server/auth";

import { resolveApplicableBudgetsForDraftKey } from "~/server/gateway/applicableBudgets.service";
import {
  chRepoOrUndefined,
  spendRepoOrUndefined,
} from "~/server/gateway/clickhouseRepos";
import { GatewayUsageService } from "~/server/gateway/usage.service";
import {
  VirtualKeyService,
  virtualKeyBudgetInputSchema,
} from "~/server/gateway/virtualKey.service";
import { startOfCurrentMonthUTC } from "~/server/gateway/virtualKeySpend.clickhouse.repository";
import {
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
} from "~/server/gateway/virtualKey.config";
import { toVirtualKeyCamelDto } from "~/server/gateway/virtualKey.dto";
import { scopeAssignmentSchema } from "~/server/scopes/scope.types";

import { authorizeInResolver } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  assertActorCanManageAllScopes,
  assertActorCanOperateOnAnyScope,
  assertGuardrailAttachmentsAllowed,
  assertScopesBelongToOrg,
  assertTraceProjectBelongsToOrg,
  isVisibleToMembership,
  loadMembershipSet,
  resolveVkProjectId,
  type VirtualKeyActor,
} from "~/server/gateway/virtualKey.authz";

/** The session expressed in the shared actor vocabulary. */
function sessionActor(session: Session): VirtualKeyActor {
  return { kind: "session", session };
}

/**
 * Load a key for a by-id READ with the list's visibility rule: a key
 * outside the caller's membership set is indistinguishable from one that
 * doesn't exist. Mutations deliberately do NOT use this — their contract
 * is permission-based (the op-perm on any existing scope), so a holder
 * of a scope role binding can operate without being a member
 * (vk-scope-rbac.feature), and an unauthorized caller gets FORBIDDEN,
 * as virtual-key-access-boundaries.feature pins.
 */
async function requireVisibleVk(
  ctx: { prisma: PrismaClient; session: Session },
  organizationId: string,
  id: string,
) {
  const service = VirtualKeyService.create(ctx.prisma);
  const vk = await service.getById(id, organizationId);
  if (!vk) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  const membership = await loadMembershipSet(
    ctx.prisma,
    organizationId,
    ctx.session.user.id,
  );
  if (!isVisibleToMembership(membership, vk.scopes)) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return vk;
}

const scopeInputSchema = scopeAssignmentSchema;

const routingModeSchema = z.enum(["NONE", "FALLBACK_ALL", "POLICY"]);

const budgetInputSchema = virtualKeyBudgetInputSchema;

const idInput = z.object({ organizationId: z.string(), id: z.string() });

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
      // A key the caller can't see is indistinguishable from one that
      // doesn't exist — same NOT_FOUND, no existence leak.
      const vk = await requireVisibleVk(ctx, input.organizationId, input.id);
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
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "spend_source_unavailable",
        });
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
        const vk = await requireVisibleVk(
          ctx,
          input.organizationId,
          input.virtualKeyId,
        );
        return resolveApplicableBudgetsForDraftKey(
          ctx.prisma,
          {
            organizationId: input.organizationId,
            virtualKeyId: vk.id,
            scopes: vk.scopes.map((scope) => ({
              scopeType: scope.scopeType,
              scopeId: scope.scopeId,
            })),
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
      await assertActorCanManageAllScopes(
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        await assertActorCanManageAllScopes(
          { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "principalUserId is not a member of this organization.",
          });
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
      await assertActorCanManageAllScopes(
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        await assertActorCanManageAllScopes(
          { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Mutating an existing key needs virtualKeys:update on one of the
      // scopes it already lives in.
      await assertActorCanOperateOnAnyScope(
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
        existing.scopes,
        "virtualKeys:update",
      );
      // Re-scoping additionally needs manage on every NEW scope, so a key
      // can't be moved into a scope the caller doesn't control.
      if (input.scopes) {
        await assertActorCanManageAllScopes(
          { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
          await assertActorCanManageAllScopes(
            { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertActorCanOperateOnAnyScope(
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertActorCanOperateOnAnyScope(
        { prisma: ctx.prisma, actor: sessionActor(ctx.session) },
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
