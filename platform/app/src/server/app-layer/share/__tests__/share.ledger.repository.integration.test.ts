/**
 * @vitest-environment node
 *
 * ADR-092 delivery-plan PR 3 (D-PR3-10, decision 22) — the share link's view
 * budget, against a real Postgres.
 *
 * The unit suite next door pins the statements this repository issues and the
 * branch it takes. Everything here is the part a mock cannot honestly stand in
 * for, because it is the DATABASE's behaviour that carries the property:
 *
 *   - the conditional increment is what stops a capped link over-consuming,
 *     and its atomicity is the row lock, not our code;
 *   - the unique violation on `GrantUsage` is what tells a first view from a
 *     spent one, and only the primary key can raise it;
 *   - the budget the cutover HANDS OVER is the count the engine's share-link
 *     read reports, which means an exhausted link stays exhausted the moment
 *     its organization is served by the ledger's head.
 *
 * A mocked version of any of those asserts what we already believe, in the
 * shape we already believe it.
 *
 * @see specs/traces-v2/sharing.feature
 */
import { AuthzCollectorService } from "@langwatch/authz-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  type Project,
  ShareResourceType,
  ShareVisibility,
  type Team,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { resetAuthzEngineGateForTesting } from "../../authz/engine-gate";
import type { GrantsLedgerWriter } from "../../authz/ledger";
import { GrantsAuthzReadRepository } from "../../authz/repositories/authz-read.grants.repository";
import { LedgerShareRepository } from "../repositories/share.ledger.repository";
import { PrismaShareRepository } from "../repositories/share.prisma.repository";

const ns = `share-ledger-${nanoid(8)}`;

/** The link under test: capped at two views, already opened once, exactly as
 *  the cutover would have handed it over. */
const MAX_VIEWS = 2;
const SEEDED_VIEWS = 1;

describe("given a cut-over organization's capped share link", () => {
  let organization: Organization;
  let team: Team;
  let project: Project;
  let traceId: string;
  let token: string;
  let shareLinkId: string;

  /** Never reached: every case here is a read or an accounting write, and a
   *  mint or a revoke would be a different suite. */
  const writer = {
    attachResourceGrant: async () => {
      throw new Error("this suite mints nothing");
    },
    revokeResourceGrants: async () => {
      throw new Error("this suite revokes nothing");
    },
  } as unknown as GrantsLedgerWriter;

  const repository = () =>
    new LedgerShareRepository({
      legacy: new PrismaShareRepository(prisma),
      prisma,
      writer: () => writer,
    });

  const usage = () =>
    prisma.grantUsage.findFirst({
      where: {
        grantId: shareLinkId,
        organizationId: organization.id,
        projectId: project.id,
      },
    });

  const consume = () =>
    repository().consumeView({
      id: shareLinkId,
      projectId: project.id,
      maxViews: MAX_VIEWS,
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Share Ledger Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Share Ledger Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Share Ledger Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    traceId = `trace_${ns}`;
    token = `--test-share-token-${ns}`;

    // The organization as a finished cutover leaves it: on the engine, with
    // the link's fact on the grant head and its compat row alongside.
    await prisma.authzCutoverProjection.create({
      data: { organizationId: organization.id, onEngine: true },
    });
    const shareLink = await prisma.shareLink.create({
      data: {
        token,
        resourceType: ShareResourceType.TRACE,
        resourceId: traceId,
        projectId: project.id,
        visibility: ShareVisibility.PUBLIC,
        maxViews: MAX_VIEWS,
        viewCount: SEEDED_VIEWS,
      },
    });
    shareLinkId = shareLink.id;
    await prisma.grant.create({
      data: {
        id: shareLinkId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.ANYONE,
        principalId: null,
        roleKey: null,
        source: "cutover-import",
        scopeType: GrantScopeType.RESOURCE,
        scopeId: traceId,
        token,
        permission: "traces:view",
        resourceKind: "TRACE",
        projectId: project.id,
        maxViews: MAX_VIEWS,
        occurredAt: new Date(),
      },
    });
  });

  beforeEach(async () => {
    resetAuthzEngineGateForTesting();
    // Every case starts from the handed-over budget, whatever the last one
    // spent.
    await cleanupTestRows(prisma, [["grantUsage", { grantId: shareLinkId }]]);
    await prisma.grantUsage.create({
      data: {
        grantId: shareLinkId,
        organizationId: organization.id,
        projectId: project.id,
        viewCount: SEEDED_VIEWS,
      },
    });
    await prisma.shareLink.updateMany({
      where: { id: shareLinkId, projectId: project.id },
      data: { viewCount: SEEDED_VIEWS },
    });
  });

  afterAll(async () => {
    resetAuthzEngineGateForTesting();
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["grantUsage", { organizationId: organization.id }],
      ["shareLink", { projectId: project.id }],
      ["grant", { organizationId: organization.id }],
      ["authzCutoverProjection", { organizationId: organization.id }],
      ["project", { id: project.id }],
      ["team", { id: team.id }],
      ["organization", { id: organization.id }],
    ]);
  });

  describe("when a view is consumed", () => {
    /** @scenario "A cut-over organization's share link consumes its remaining budget" */
    it("counts against the budget it was handed, not from zero", async () => {
      expect(await consume()).toBe(true);

      expect((await usage())?.viewCount).toBe(SEEDED_VIEWS + 1);
      // The compat column is mirrored so a rolled-back organization keeps
      // counting from where the ledger got to.
      expect(
        (
          await prisma.shareLink.findFirst({
            where: { id: shareLinkId, projectId: project.id },
          })
        )?.viewCount,
      ).toBe(SEEDED_VIEWS + 1);
    });

    /** @scenario "A cut-over organization's share link consumes its remaining budget" */
    it("refuses the view that would take the link past its cap", async () => {
      expect(await consume()).toBe(true);

      // The budget is spent now: the conditional increment matches no row,
      // and the compat count is left exactly where it was.
      expect(await consume()).toBe(false);
      expect((await usage())?.viewCount).toBe(MAX_VIEWS);
      expect(
        (
          await prisma.shareLink.findFirst({
            where: { id: shareLinkId, projectId: project.id },
          })
        )?.viewCount,
      ).toBe(MAX_VIEWS);
    });

    it("admits exactly the remaining views when several viewers open at once", async () => {
      // Four concurrent opens against one remaining view. The cap is held by
      // the statement, so precisely one of them may win.
      const outcomes = await Promise.all([
        consume(),
        consume(),
        consume(),
        consume(),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(MAX_VIEWS - SEEDED_VIEWS);
      expect((await usage())?.viewCount).toBe(MAX_VIEWS);
    });

    describe("when the link has no usage row at all", () => {
      it("creates it on the first view rather than losing the count", async () => {
        await cleanupTestRows(prisma, [
          ["grantUsage", { grantId: shareLinkId }],
        ]);

        expect(await consume()).toBe(true);

        expect((await usage())?.viewCount).toBe(1);
      });

      it("lets exactly one of two simultaneous first views create it", async () => {
        // The race the create exists to resolve: the unique violation on the
        // primary key is what tells the loser it was a race and not a cap.
        await cleanupTestRows(prisma, [
          ["grantUsage", { grantId: shareLinkId }],
        ]);

        const outcomes = await Promise.all([consume(), consume()]);

        expect(outcomes.filter(Boolean)).toHaveLength(2);
        expect((await usage())?.viewCount).toBe(2);
      });
    });
  });

  describe("when the engine reads the link back", () => {
    const engineReader = () => new GrantsAuthzReadRepository(prisma);

    /** @scenario "A cut-over organization's share link consumes its remaining budget" */
    it("reports the views this repository counted", async () => {
      await consume();

      const links = await engineReader().findShareLinks({
        projectId: project.id,
        tokens: [token],
        links: [{ kind: "trace", id: traceId }],
      });

      expect(links).toEqual([
        expect.objectContaining({
          resourceId: traceId,
          maxViews: MAX_VIEWS,
          viewCount: SEEDED_VIEWS + 1,
        }),
      ]);
    });

    /** @scenario "An exhausted share link stays exhausted after cutover" */
    it("grants nothing once the budget is spent", async () => {
      const collector = new AuthzCollectorService(engineReader());
      const scope = await collector.resolveResourceScopeRef({
        projectId: project.id,
        kind: "trace",
        id: traceId,
        shareTokens: [token],
      });
      expect(scope).not.toBeNull();

      // While a view remains, possession of the token is a grant.
      expect(await collector.collectResourceGrants({ scope: scope! })).toEqual([
        expect.objectContaining({ id: traceId, permission: "traces:view" }),
      ]);

      await consume();

      // Spent: the row is still there and the token is still presented, and
      // the link confers nothing at all.
      expect(await collector.collectResourceGrants({ scope: scope! })).toEqual(
        [],
      );
    });
  });
});
