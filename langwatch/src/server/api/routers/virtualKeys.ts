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
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { PrismaClient } from "@prisma/client";

import type { Session } from "~/server/auth";

import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import {
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
  type GuardrailAttachment,
} from "~/server/gateway/virtualKey.config";
import { toVirtualKeyCamelDto } from "~/server/gateway/virtualKey.dto";

import { authorizeInResolver, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  assertCanManageAllScopes,
  assertCanOperateOnAnyScope,
  isVisibleToMembership,
  loadMembershipSet,
} from "~/server/gateway/virtualKey.authz";

const scopeInputSchema = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
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
): Promise<string | null> {
  let scopes = inputScopes;
  if (!scopes && vkId) {
    const vk = await prisma.virtualKey.findFirst({
      where: { id: vkId, organizationId },
      select: { scopes: { select: { scopeType: true, scopeId: true } } },
    });
    scopes = vk?.scopes;
  }
  const projectScopes = (scopes ?? []).filter((s) => s.scopeType === "PROJECT");
  return projectScopes.length === 1 ? projectScopes[0]!.scopeId : null;
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `scope_org_mismatch: scope ${s.scopeId} is not in organization ${organizationId}`,
      });
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `scope_org_mismatch: team ${id} is not in organization ${organizationId}`,
        });
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `scope_org_mismatch: project ${id} is not in organization ${organizationId}`,
        });
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
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "guardrail_project_mismatch: virtual key is not scoped to a single project",
    });
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `guardrail_project_mismatch: guardrail ${id} is not in the virtual key's project`,
      });
    }
  }

  const allowed = await hasProjectPermission(
    ctx,
    vkProjectId,
    "gatewayGuardrails:attach",
  );
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "missing_perm:gatewayGuardrails:attach",
    });
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
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const membership = await loadMembershipSet(
        ctx.prisma,
        input.organizationId,
        ctx.session.user.id,
      );
      if (!isVisibleToMembership(membership, vk.scopes)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return toVirtualKeyCamelDto(vk);
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        principalUserId: z.string().nullable().optional(),
        scopes: z.array(scopeInputSchema).min(1),
        routingPolicyId: z.string().nullable().optional(),
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
      const vkProjectId = await resolveVkProjectId(
        ctx.prisma,
        input.organizationId,
        null,
        input.scopes,
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
        routingPolicyId: input.routingPolicyId ?? null,
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
        routingPolicyId: z.string().nullable().optional(),
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
      const vkProjectId = await resolveVkProjectId(
        ctx.prisma,
        input.organizationId,
        input.id,
        input.scopes,
      );
      // Newly-submitted attachments are always validated. When the caller
      // is ALSO changing scopes (a possible project move) but did not
      // re-send config, revalidate the existing attachments against the
      // new project so a stale cross-project attachment can't survive the
      // move. A plain metadata update (no scope change, no new
      // attachments) must not re-touch existing attachments — otherwise
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
        routingPolicyId: input.routingPolicyId,
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
        throw new TRPCError({ code: "NOT_FOUND" });
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
