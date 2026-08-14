// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for usage attribution (ADR-094): who spent the money a provider
 * reported, and the admin surface that answers that question when the link
 * list cannot.
 *
 * Two permission levels, and the split is the point.
 *
 *   - READS are gated on `governance:view`. The report names people and what
 *     they spent, so it belongs with the other admin-only governance reads and
 *     never with the member floor.
 *   - WRITES are gated on `organization:manage`. A link row decides whose
 *     money last quarter's spend was, and a correction rewrites that answer,
 *     so appending one is an organization-administration act rather than a
 *     reporting one.
 *
 * Nothing here participates in a permission decision (ADR-094 Decision 10).
 * The link list answers "who was this login" for reporting, and a dependency
 * test keeps the authorization packages from ever importing it.
 *
 * Spec: dev/docs/adr/094-usage-attribution-login-to-person-links.md
 */

import {
  EXTERNAL_KINDS_BY_PROVIDER,
  emailKindsForProvider,
  LINK_ORDERING,
  LINK_SOURCES,
} from "@langwatch/identity-links";
import { z } from "zod";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

import { AttributionLinkAdminService } from "../services/attributionLinkAdmin.service";
import { createUsageAttributionReportService } from "../services/usageAttributionReport.service";

/**
 * The window every report call takes. Half-open [from, to) so two adjacent
 * windows can never both claim the instant on their shared boundary — which
 * is the same rule the ownership split uses, and they have to agree.
 */
const windowInput = z.object({
  organizationId: z.string(),
  fromMs: z.number().int().nonnegative(),
  toMs: z.number().int().nonnegative(),
});

const loginRefInput = z.object({
  provider: z.string().min(1).max(64),
  providerConnectionId: z.string().min(1),
  externalKind: z.string().min(1).max(64),
  externalId: z.string().min(1).max(512),
});

/**
 * The sources an admin may name. `offboarding` is absent on purpose: it is the
 * lifecycle hook's own word for "a membership ended", and letting a person
 * hand-write it would put a claim in the paper trail that no membership change
 * backs.
 */
const adminLinkSource = z.enum(
  LINK_SOURCES.filter((source) => source !== "offboarding") as [
    "manual",
    "external_id",
    "email_suggestion_accepted",
  ],
);

const asWindow = (input: { fromMs: number; toMs: number }) => {
  const from = new Date(input.fromMs);
  const to = new Date(input.toMs);
  if (to.getTime() <= from.getTime()) {
    throw new Error("Report window must end after it starts");
  }
  return { from, to };
};

export const usageAttributionRouter = createTRPCRouter({
  /**
   * The report: three buckets that always add back up to the ledger.
   *
   * Empty-state safe in the same way every other governance read is — an
   * organization with no hidden governance project has never ingested a
   * governance event, and gets zeros rather than an error.
   */
  report: protectedProcedure
    .input(windowInput)
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      const { from, to } = asWindow(input);
      const wired = await createUsageAttributionReportService({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
      });
      return await wired.service.report({
        organizationId: input.organizationId,
        tenantId: wired.tenantId,
        from,
        to,
      });
    }),

  /**
   * Produce the report AND record that this window left the building.
   *
   * A mutation rather than a query because it writes: from here on, a link
   * appended with an `effectiveFrom` inside this window makes the next report
   * say so (ADR-094 Decision 3). Gated on `organization:manage` rather than
   * `governance:view` — declaring a period reported is a commitment, not a
   * look.
   */
  exportReport: protectedProcedure
    .input(windowInput)
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const { from, to } = asWindow(input);
      const wired = await createUsageAttributionReportService({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
      });
      return await wired.service.export({
        organizationId: input.organizationId,
        tenantId: wired.tenantId,
        from,
        to,
        // From the session, never the input. An actor an admin could type is
        // an audit trail an admin could forge.
        actorUserId: ctx.session.user.id,
      });
    }),

  /** One login's whole history, newest first by the ADR's ordering constant. */
  listTimeline: protectedProcedure
    .input(z.object({ organizationId: z.string(), login: loginRefInput }))
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      const service = AttributionLinkAdminService.create(ctx.prisma);
      return {
        ordering: LINK_ORDERING,
        rows: await service.listTimeline({
          organizationId: input.organizationId,
          login: input.login,
        }),
      };
    }),

  /**
   * Candidate matches for logins nobody has claimed yet.
   *
   * Suggestions only. Nothing here writes a row, and that is a locked decision
   * rather than an unfinished feature: an automatic match is a guess about
   * whose money this is, and the two designs that guessed — by email, by
   * last-write-wins — are why this ADR exists. An admin confirms, which turns
   * the suggestion into a `createLink` call carrying the evidence that
   * convinced them as its `source`.
   */
  suggestions: protectedProcedure
    .input(windowInput)
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const { from, to } = asWindow(input);
      const wired = await createUsageAttributionReportService({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
      });
      const report = await wired.service.report({
        organizationId: input.organizationId,
        tenantId: wired.tenantId,
        from,
        to,
      });
      const service = AttributionLinkAdminService.create(ctx.prisma);
      return {
        suggestions: await service.suggestionsFor({
          organizationId: input.organizationId,
          unattributed: report.rows.filter(
            (row) => row.bucket === "unattributed",
          ),
        }),
      };
    }),

  /**
   * Append a link row. Corrections and backdates go through here too — the
   * list is add-only, so "changing" a link is appending the row that wins.
   */
  createLink: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        login: loginRefInput,
        userId: z.string().min(1),
        effectiveFromMs: z.number().int().nonnegative(),
        source: adminLinkSource,
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AttributionLinkAdminService.create(ctx.prisma);
      return await service.createLink({
        organizationId: input.organizationId,
        login: input.login,
        userId: input.userId,
        effectiveFrom: new Date(input.effectiveFromMs),
        source: input.source,
        actorUserId: ctx.session.user.id,
      });
    }),

  /**
   * Close a link: append a row owned by nobody, in force from
   * `effectiveFromMs` on. It is not a delete — the rows that came before stay
   * exactly as they are, so who spent last quarter's money still reads true.
   */
  closeLink: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        login: loginRefInput,
        effectiveFromMs: z.number().int().nonnegative(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AttributionLinkAdminService.create(ctx.prisma);
      return await service.closeLink({
        organizationId: input.organizationId,
        login: input.login,
        effectiveFrom: new Date(input.effectiveFromMs),
        actorUserId: ctx.session.user.id,
      });
    }),

  /** The id namespaces each provider declares, for the manual-link form. */
  externalKinds: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
    .query(() =>
      Object.entries(EXTERNAL_KINDS_BY_PROVIDER).map(([provider, kinds]) => ({
        provider,
        kinds: [...kinds],
        // Which of them hold an address, so the form can say so — those are
        // the ones the service canonicalizes on the way in, and an admin who
        // types one in title case should not be surprised by what comes back.
        emailKinds: [...emailKindsForProvider(provider)],
      })),
    ),
});
