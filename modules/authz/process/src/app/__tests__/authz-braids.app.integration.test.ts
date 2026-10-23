/**
 * @vitest-environment node
 * Braids through the tRPC door over the composed authz app: its grants pipeline runs in memory,
 * so every write lands in the ledger, the projection and the audit trail (ADR-185).
 * @see modules/authz/specs/braids.feature
 */
import { BRAID_CONDITION_COMPILER_VERSION, usableAuthorization } from "@langwatch/authorization";
import { BRAID_AUDIT_TARGET_KIND, compileBraidCondition } from "@langwatch/authz-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTHORIZATION_MAX_AGE_MS,
  BRAID_REVOCATION_BOUND_MS,
} from "../../services/authorization.service.ts";
import { BRAIDED_SPANS_VIEWED_ACTION } from "../../services/authz-braided-read-audit.service.ts";
import { BRAIDS_POLICY_CHANGED_ACTION } from "../../services/authz-organization-policy.service.ts";
import {
  braidWorld,
  failureOf,
  FRONTDESK,
  ORCHESTRATOR,
  ORG,
  refusalOf,
  SPECIALISTS,
  TEAMS,
} from "./authz-braid-world.fixture.ts";

const ANA = "user_ana";
/** A second organisation admin. */
const ADE = "user_ade";
const TOM = "user_tom";
const OLU = "user_olu";
const SAM = "user_sam";
const DENIED = "permission_denied";
const FROM_MS = Date.UTC(2026, 9, 1);
const WEB = 'attributes["orchestrator"] == "web"';
const PAYMENTS = 'name == "payments_agent"';

type World = Awaited<ReturnType<typeof braidWorld>>;
let worlds: World[] = [];

/** The Background's organisation, ana its admin. */
async function world(options: Parameters<typeof braidWorld>[0] = {}): Promise<World> {
  const made = await braidWorld(options);
  worlds.push(made);
  await made.seat(ANA, { organizationAdmin: true });
  return made;
}

afterEach(async () => {
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
});

const braidInput = (overrides: { where?: string; fromMs?: number; expiresAtMs?: number } = {}) => ({
  projectId: SPECIALISTS,
  readerProjectId: ORCHESTRATOR,
  where: WEB,
  fromMs: FROM_MS,
  ...overrides,
});

const live = (rows: ReturnType<World["braidRows"]>) => rows.filter((row) => row.revokedAt === null);

describe("a braid as a shared grant", () => {
  describe("when ana braids specialists into orchestrator with a condition", () => {
    /** @scenario "Creating a braid attaches a span read from the owner to the reader" */
    /** @scenario "A compiled condition carries the compiler's version" */
    it("holds a live project-reader grant from orchestrator on specialists, sourced braid, its condition as written and compiled", async () => {
      const { as, braidRows } = await world();
      const compiled = compileBraidCondition({ text: WEB });
      if (!compiled.ok) throw new Error("the condition did not compile");

      const braid = await as(ANA).createBraid(braidInput());

      expect(braidRows()).toEqual([
        expect.objectContaining({
          id: braid.braidId,
          principalType: "PROJECT",
          principalId: ORCHESTRATOR,
          roleKey: "project-reader",
          scopeType: "PROJECT",
          scopeId: SPECIALISTS,
          source: "braid",
          revokedAt: null,
          condition: expect.objectContaining({
            type: "span",
            where: WEB,
            compiledWhere: compiled.compiledWhere,
          }),
        }),
      ]);
      expect(braidRows()[0]?.condition).toMatchObject({
        compiledWhere: { version: BRAID_CONDITION_COMPILER_VERSION },
      });
    });
  });

  describe("given an organisation below Enterprise", () => {
    /** @scenario "Braids need the Enterprise plan" */
    it("refuses creating and changing a braid naming Braids, and still removes and lists", async () => {
      const { as, plan, braidRows } = await world();
      const braid = await as(ANA).createBraid(braidInput());
      plan.enterprise = false;

      const created = await failureOf(as(ANA).createBraid(braidInput({ where: PAYMENTS })));
      const changed = await failureOf(
        as(ANA).changeBraid({ ...braidInput({ where: PAYMENTS }), braidId: braid.braidId }),
      );

      for (const refusal of [created, changed]) {
        expect(refusal).toMatchObject({
          code: "enterprise_plan_required",
          meta: { feature: "BRAIDS" },
        });
      }
      expect(braidRows()).toHaveLength(1);
      await expect(as(ANA).listOrganizationBraids({ organizationId: ORG })).resolves.toEqual([
        expect.objectContaining({ braidId: braid.braidId }),
      ]);
      await expect(
        as(ANA).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId }),
      ).resolves.toEqual({ braidId: braid.braidId });
      expect(live(braidRows())).toEqual([]);
    });
  });

  describe("when two organisation admins ask for the same braid at the same moment", () => {
    /** @scenario "Two admins making the same braid at once leave one braid" */
    it("makes exactly one live braid and refuses the other with braid_already_exists", async () => {
      const { as, seat, braidRows } = await world();
      await seat(ADE, { organizationAdmin: true });

      const outcomes = await Promise.all([
        refusalOf(as(ANA).createBraid(braidInput())),
        refusalOf(as(ADE).createBraid(braidInput())),
      ]);

      expect(outcomes.filter((code) => code === undefined)).toHaveLength(1);
      expect(outcomes.filter((code) => code !== undefined)).toEqual(["braid_already_exists"]);
      expect(braidRows()).toHaveLength(1);
      expect(live(braidRows())).toHaveLength(1);
    });
  });
});

describe("who may braid", () => {
  describe("when sam, a member who may create public share links, asks", () => {
    /** @scenario "A member may not create, change or remove a braid" */
    it("refuses creating, changing and removing as a permission denial and attaches nothing", async () => {
      const { app, as, seat, braidRows } = await world();
      await seat(SAM, { teams: { [TEAMS.specialists]: "member", [TEAMS.orchestrator]: "member" } });
      const braid = await as(ANA).createBraid(braidInput());
      const shares = await app.getDecision({
        userId: SAM,
        permission: "traces:share",
        scope: { tier: "project", id: SPECIALISTS },
      });

      const refusals = [
        await failureOf(as(SAM).createBraid(braidInput({ where: PAYMENTS }))),
        await failureOf(
          as(SAM).changeBraid({ ...braidInput({ where: PAYMENTS }), braidId: braid.braidId }),
        ),
        await failureOf(as(SAM).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId })),
      ];

      expect(shares.permitted).toBe(true);
      for (const refusal of refusals) {
        expect(refusal).toMatchObject({ code: DENIED, meta: { permission: "braids:manage" } });
      }
      expect(braidRows()).toEqual([
        expect.objectContaining({ id: braid.braidId, revokedAt: null }),
      ]);
    });
  });

  describe("when tom, an admin of specialists' team and a viewer of orchestrator, braids", () => {
    /** @scenario "A project's admin may braid out of it into a project they can read" */
    it("makes a live braid naming tom as its creator", async () => {
      const { as, seat, braidRows } = await world();
      await seat(TOM, { teams: { [TEAMS.specialists]: "admin", [TEAMS.orchestrator]: "viewer" } });

      const braid = await as(TOM).createBraid(braidInput());

      expect(braid.createdByUserId).toBe(TOM);
      expect(live(braidRows())).toEqual([
        expect.objectContaining({ id: braid.braidId, createdByUserId: TOM }),
      ]);
    });
  });

  describe("when tom cannot read orchestrator's traces", () => {
    /** @scenario "Nobody braids into a project they cannot read" */
    it("refuses at the door on the reader's traces:view, before the braid is read or written", async () => {
      const { app, as, seat, repositories, braidRows } = await world();
      await seat(TOM, { teams: { [TEAMS.specialists]: "admin" } });
      const handled = vi.spyOn(app, "createBraid");
      const braidReads = vi.spyOn(repositories.ledgerReads, "findBraids");
      const locks = vi.spyOn(repositories.braidLocks, "withReaderLock");

      const refusal = await failureOf(as(TOM).createBraid(braidInput()));

      expect(refusal).toMatchObject({ code: DENIED, meta: { permission: "traces:view" } });
      expect(handled).not.toHaveBeenCalled();
      expect(braidReads).not.toHaveBeenCalled();
      expect(locks).not.toHaveBeenCalled();
      expect(braidRows()).toEqual([]);
    });
  });

  describe("when olu, an admin of orchestrator's team with no role on specialists, removes it", () => {
    /** @scenario "Either project's admins may remove a braid" */
    it("revokes the grant from the reader's side with reason braid_removed", async () => {
      const { as, seat, braidRows } = await world();
      await seat(OLU, { teams: { [TEAMS.orchestrator]: "admin" } });
      const braid = await as(ANA).createBraid(braidInput());

      await expect(
        as(OLU).removeBraid({ projectId: ORCHESTRATOR, braidId: braid.braidId }),
      ).resolves.toEqual({ braidId: braid.braidId });

      expect(braidRows()).toEqual([
        expect.objectContaining({ id: braid.braidId, revokedReason: "braid_removed" }),
      ]);
      expect(live(braidRows())).toEqual([]);
    });
  });
});

describe("keeping braids to organisation admins", () => {
  const keep = (world: World, userId: string) =>
    world.as(userId).setBraidsPolicy({ organizationId: ORG, braidsOrganizationAdminsOnly: true });

  describe("when the organisation keeps braids to its admins", () => {
    /** @scenario "With braids kept to organisation admins, a team admin may not braid" */
    it("refuses tom as a permission denial and accepts ana's same braid", async () => {
      const made = await world();
      await made.seat(TOM, {
        teams: { [TEAMS.specialists]: "admin", [TEAMS.orchestrator]: "viewer" },
      });
      await keep(made, ANA);

      const refusal = await failureOf(made.as(TOM).createBraid(braidInput()));
      const accepted = await made.as(ANA).createBraid(braidInput());

      expect(refusal).toMatchObject({ code: DENIED, meta: { permission: "braids:manage" } });
      expect(live(made.braidRows())).toEqual([
        expect.objectContaining({ id: accepted.braidId, createdByUserId: ANA }),
      ]);
    });
  });

  describe("given a live braid tom made while project admins could braid", () => {
    /** @scenario "Keeping braids to organisation admins leaves live braids in place" */
    it("leaves the braid live and refuses tom's change and removal at once, cached decisions or not", async () => {
      const made = await world({ epochCacheEnabled: true });
      await made.seat(TOM, {
        teams: { [TEAMS.specialists]: "admin", [TEAMS.orchestrator]: "viewer" },
      });
      const braid = await made.as(TOM).createBraid(braidInput());
      // Tom's standing on specialists is decided, and cached, after the braid's own write.
      await made.as(TOM).listBraidTargets({ projectId: SPECIALISTS, projectIds: [ORCHESTRATOR] });

      await keep(made, ANA);
      const changed = await failureOf(
        made.as(TOM).changeBraid({ ...braidInput({ where: PAYMENTS }), braidId: braid.braidId }),
      );
      const removed = await failureOf(
        made.as(TOM).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId }),
      );

      expect(live(made.braidRows())).toEqual([expect.objectContaining({ id: braid.braidId })]);
      await expect(made.as(ANA).listBraids({ projectId: ORCHESTRATOR })).resolves.toMatchObject({
        fromOtherProjects: [{ braidId: braid.braidId }],
      });
      expect(changed).toMatchObject({ code: DENIED, meta: { permission: "braids:manage" } });
      expect(removed).toMatchObject({ code: DENIED, meta: { permission: "braids:manage" } });
    });
  });

  describe("when tom asks to keep braids to the organisation's admins", () => {
    /** @scenario "Only an organisation admin may change who can braid" */
    it("refuses tom as a permission denial, and accepts and audits ana's change", async () => {
      const made = await world();
      await made.seat(TOM, { teams: { [TEAMS.specialists]: "admin" } });

      const refusal = await failureOf(keep(made, TOM));
      const policyAfterTom = await made.app.getOrganizationPolicy({ organizationId: ORG });
      const accepted = await keep(made, ANA);

      expect(refusal).toMatchObject({ code: DENIED, meta: { permission: "organization:manage" } });
      expect(policyAfterTom.braidsOrganizationAdminsOnly).toBe(false);
      expect(accepted).toMatchObject({ braidsOrganizationAdminsOnly: true, updatedByUserId: ANA });
      expect(made.auditRows().filter((row) => row.action === BRAIDS_POLICY_CHANGED_ACTION)).toEqual(
        [
          expect.objectContaining({
            userId: ANA,
            organizationId: ORG,
            metadata: { braidsOrganizationAdminsOnly: true, previous: false },
          }),
        ],
      );
    });
  });

  describe("given an organisation below Enterprise", () => {
    /** @scenario "Changing who can braid needs the Enterprise plan" */
    it("refuses ana's change with enterprise_plan_required naming Braids", async () => {
      const made = await world({ enterprise: false });

      expect(await failureOf(keep(made, ANA))).toMatchObject({
        code: "enterprise_plan_required",
        meta: { feature: "BRAIDS" },
      });
      await expect(made.app.getOrganizationPolicy({ organizationId: ORG })).resolves.toMatchObject({
        braidsOrganizationAdminsOnly: false,
      });
    });
  });
});

describe("changing and removing a braid", () => {
  const change = (made: World, userId: string, braidId: string, where: string) =>
    made.as(userId).changeBraid({ ...braidInput({ where }), braidId });

  describe("when ana changes a live braid's condition", () => {
    /** @scenario "Changing a braid replaces it and names the braid it replaced" */
    it("attaches a new grant naming the old, revokes the old, and lists only the new", async () => {
      const made = await world();
      const braid = await made.as(ANA).createBraid(braidInput());

      const changed = await change(made, ANA, braid.braidId, PAYMENTS);

      expect(made.braidRows()).toEqual([
        expect.objectContaining({ id: braid.braidId, revokedReason: "braid_changed" }),
        expect.objectContaining({
          id: changed.braidId,
          revokedAt: null,
          replacesGrantId: braid.braidId,
          condition: expect.objectContaining({ where: PAYMENTS }),
        }),
      ]);
      expect(live(made.braidRows()).map((row) => row.id)).toEqual([changed.braidId]);
      await expect(made.as(ANA).listBraids({ projectId: SPECIALISTS })).resolves.toMatchObject({
        intoOtherProjects: [{ braidId: changed.braidId, where: PAYMENTS }],
      });
    });
  });

  describe("when ana and another admin change one braid at the same moment", () => {
    /** @scenario "Two people changing one braid at once leave one change" */
    it("keeps one change live, refuses the other with braid_changed, and attaches no third grant", async () => {
      const made = await world();
      await made.seat(ADE, { organizationAdmin: true });
      const braid = await made.as(ANA).createBraid(braidInput());

      const outcomes = await Promise.all([
        refusalOf(change(made, ANA, braid.braidId, PAYMENTS)),
        refusalOf(change(made, ADE, braid.braidId, 'name == "billing_agent"')),
      ]);

      expect(outcomes.filter((code) => code === undefined)).toHaveLength(1);
      expect(outcomes.filter((code) => code !== undefined)).toEqual(["braid_changed"]);
      expect(made.braidRows()).toHaveLength(2);
      expect(live(made.braidRows())).toEqual([
        expect.objectContaining({ replacesGrantId: braid.braidId }),
      ]);
    });
  });

  describe("when attaching the changed grant fails", () => {
    /** @scenario "A change whose new grant cannot be attached leaves the braid as it was" */
    it("reports the failure and leaves the old braid live with its old condition", async () => {
      const made = await world();
      const braid = await made.as(ANA).createBraid(braidInput());
      made.failNext("attachGrant");

      const refusal = await failureOf(change(made, ANA, braid.braidId, PAYMENTS));

      expect(refusal).toBeDefined();
      expect(made.braidRows()).toEqual([
        expect.objectContaining({
          id: braid.braidId,
          revokedAt: null,
          condition: expect.objectContaining({ where: WEB }),
        }),
      ]);
    });
  });

  describe("when revoking the old grant fails once", () => {
    /** @scenario "A change whose old grant cannot be revoked reports failure and finishes when repeated" */
    it("reports the failure, and the repeat revokes the old grant without attaching a third", async () => {
      const made = await world();
      const braid = await made.as(ANA).createBraid(braidInput());
      made.failNext("revokeGrant");

      const first = await failureOf(change(made, ANA, braid.braidId, PAYMENTS));
      const repeated = await change(made, ANA, braid.braidId, PAYMENTS);

      expect(first).toBeDefined();
      expect(made.braidRows()).toEqual([
        expect.objectContaining({ id: braid.braidId, revokedReason: "braid_changed" }),
        expect.objectContaining({ id: repeated.braidId, revokedAt: null }),
      ]);
    });
  });

  describe("when ana removes a braid and makes the same one again within one second", () => {
    /** @scenario "Removing and making a braid again within one second leaves one live braid" */
    it("makes the new braid live under its own grant id and keeps the removed one removed", async () => {
      const made = await world();
      const braid = await made.as(ANA).createBraid(braidInput());
      await earlyInASecond();

      await made.as(ANA).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId });
      const again = await made.as(ANA).createBraid(braidInput());

      const [removed, made2] = made.braidRows();
      expect(again.braidId).not.toBe(braid.braidId);
      expect(removed).toMatchObject({ id: braid.braidId, revokedReason: "braid_removed" });
      expect(made2).toMatchObject({ id: again.braidId, revokedAt: null });
      expect(secondOf(removed?.revokedAt?.epochMilliseconds)).toBe(
        secondOf(made2?.occurredAt.epochMilliseconds),
      );
      expect(live(made.braidRows())).toHaveLength(1);
    });
  });

  describe("when ana removes a braid sam's reads carry", () => {
    /** @scenario "A removed braid stops showing within thirty seconds" */
    it("revokes it with braid_removed, and no proof minted after carries it, cached shared reads or not", async () => {
      const made = await world({ epochCacheEnabled: true });
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const braid = await made.as(ANA).createBraid(braidInput());
      const before = await made.mint(SAM, ORCHESTRATOR);

      await made.as(ANA).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId });
      const after = await made.mint(SAM, ORCHESTRATOR);

      expect(projectsOf(before)).toEqual([ORCHESTRATOR, SPECIALISTS]);
      expect(made.braidRows()).toEqual([
        expect.objectContaining({ id: braid.braidId, revokedReason: "braid_removed" }),
      ]);
      expect(projectsOf(after)).toEqual([ORCHESTRATOR]);
      expect(
        thrownBy(() => usableAuthorization({ authorization: before, now: before.expiresAt })),
      ).toBe("authorization_expired");
    });
  });

  describe("when sam's live view holds a proof carrying the braid as ana removes it", () => {
    /** @scenario "A read holding its proof stops showing a removed braid within thirty seconds" */
    it("refuses the held proof thirty seconds after its minting, and the view's next proof carries no braid", async () => {
      const made = await world();
      await made.seat(SAM, {
        teams: { [TEAMS.orchestrator]: "member", [TEAMS.frontdesk]: "member" },
      });
      const braid = await made.as(ANA).createBraid(braidInput());
      const mintedFrom = Date.now();
      const held = await made.mint(SAM, ORCHESTRATOR);
      const mintedBy = Date.now();
      const unbraided = await made.mint(SAM, FRONTDESK);

      await made.as(ANA).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId });
      const next = await made.mint(SAM, ORCHESTRATOR);

      expect(projectsOf(held)).toEqual([ORCHESTRATOR, SPECIALISTS]);
      expect(held.expiresAt).toBeGreaterThanOrEqual(mintedFrom + BRAID_REVOCATION_BOUND_MS);
      expect(held.expiresAt).toBeLessThanOrEqual(mintedBy + BRAID_REVOCATION_BOUND_MS);
      expect(
        thrownBy(() =>
          usableAuthorization({ authorization: held, now: mintedBy + BRAID_REVOCATION_BOUND_MS }),
        ),
      ).toBe("authorization_expired");
      expect(unbraided.expiresAt).toBeGreaterThanOrEqual(mintedFrom + AUTHORIZATION_MAX_AGE_MS);
      expect(projectsOf(next)).toEqual([ORCHESTRATOR]);
    });
  });
});

describe("a braid's data window", () => {
  describe("when ana braids today with data from the start of last month", () => {
    /** @scenario "A braid's data may start before the day it was made" */
    it("accepts the earlier start and hands it to the reader's reads as the window's start", async () => {
      const made = await world();
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const today = new Date();
      const lastMonth = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);

      const braid = await made.as(ANA).createBraid(braidInput({ fromMs: lastMonth }));
      const proof = await made.mint(SAM, ORCHESTRATOR);

      expect(braid.fromMs).toBe(lastMonth);
      expect(proof.grants[1]).toMatchObject({
        projectId: SPECIALISTS,
        via: [braid.braidId],
        condition: { type: "span", from: lastMonth, until: null },
      });
    });
  });
});

describe("listing braids", () => {
  describe("when ana lists braids on each of the two projects", () => {
    /** @scenario "The owner lists the braids out of it and the reader the braids into it" */
    it("lists the braid into other projects on the owner and from other projects on the reader, with its terms and creator", async () => {
      const made = await world();
      const expiresAtMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const braid = await made.as(ANA).createBraid(braidInput({ expiresAtMs }));
      const listed = {
        braidId: braid.braidId,
        ownerProjectId: SPECIALISTS,
        readerProjectId: ORCHESTRATOR,
        where: WEB,
        fromMs: FROM_MS,
        expiresAtMs,
        createdByUserId: ANA,
      };

      await expect(made.as(ANA).listBraids({ projectId: SPECIALISTS })).resolves.toEqual({
        intoOtherProjects: [expect.objectContaining(listed)],
        fromOtherProjects: [],
      });
      await expect(made.as(ANA).listBraids({ projectId: ORCHESTRATOR })).resolves.toEqual({
        intoOtherProjects: [],
        fromOtherProjects: [expect.objectContaining(listed)],
      });
    });
  });

  describe("when sam, a member of orchestrator alone, lists", () => {
    /** @scenario "Members of either project may list the braids that touch it" */
    it("lists the braid from specialists on orchestrator and refuses listing specialists", async () => {
      const made = await world();
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const braid = await made.as(ANA).createBraid(braidInput());

      await expect(made.as(SAM).listBraids({ projectId: ORCHESTRATOR })).resolves.toMatchObject({
        fromOtherProjects: [{ braidId: braid.braidId, ownerProjectId: SPECIALISTS }],
      });
      expect(await failureOf(made.as(SAM).listBraids({ projectId: SPECIALISTS }))).toMatchObject({
        code: DENIED,
      });
    });
  });
});

describe("the audit log", () => {
  describe("when ana creates, changes and then removes a braid", () => {
    /** @scenario "Creating, changing and removing a braid is in the audit log" */
    it("holds one entry for the creation, a removal and a creation for the change, and one for the removal, each naming both projects and the condition", async () => {
      const made = await world();
      const created = await made.as(ANA).createBraid(braidInput());
      const changed = await made
        .as(ANA)
        .changeBraid({ ...braidInput({ where: PAYMENTS }), braidId: created.braidId });
      await made.as(ANA).removeBraid({ projectId: SPECIALISTS, braidId: changed.braidId });
      const braidEntries = () =>
        made.auditRows().filter((row) => row.targetKind === BRAID_AUDIT_TARGET_KIND);
      await vi.waitFor(() => expect(braidEntries()).toHaveLength(4));

      const entries = braidEntries().map((row) => ({
        action: row.action,
        braid: row.targetId,
        replaces: row.metadata.replacesGrantId,
        reason: row.metadata.reason,
      }));
      expect(entries).toEqual([
        {
          action: "authz.grants.attach",
          braid: created.braidId,
          replaces: undefined,
          reason: undefined,
        },
        {
          action: "authz.grants.attach",
          braid: changed.braidId,
          replaces: created.braidId,
          reason: undefined,
        },
        {
          action: "authz.grants.revoke",
          braid: created.braidId,
          replaces: undefined,
          reason: "braid_changed",
        },
        {
          action: "authz.grants.revoke",
          braid: changed.braidId,
          replaces: undefined,
          reason: "braid_removed",
        },
      ]);
      for (const row of braidEntries()) {
        expect(row).toMatchObject({
          userId: ANA,
          projectId: SPECIALISTS,
          metadata: {
            principal: { type: "project", id: ORCHESTRATOR },
            scope: { type: "PROJECT", id: SPECIALISTS },
            condition: { type: "span", where: expect.any(String) },
          },
        });
      }
    });
  });

  describe("when sam opens three orchestrator traces holding specialists spans within five minutes", () => {
    /** @scenario "Opening traces with braided spans is audited once per five minutes" */
    it("writes one braided spans viewed entry naming sam, orchestrator and specialists, and no span or trace", async () => {
      const made = await world();
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const braid = await made.as(ANA).createBraid(braidInput());

      for (let opened = 0; opened < 3; opened++) {
        await made.app.recordBraidedSpansView({
          actor: { type: "user", id: SAM },
          readerProjectId: ORCHESTRATOR,
          ownerProjectIds: [SPECIALISTS],
        });
      }

      const viewed = made.auditRows().filter((row) => row.action === BRAIDED_SPANS_VIEWED_ACTION);
      expect(viewed).toHaveLength(1);
      expect(viewed[0]).toMatchObject({ userId: SAM, projectId: ORCHESTRATOR });
      expect(viewed[0]?.metadata).toEqual({
        actor: { type: "user", id: SAM },
        readerProjectId: ORCHESTRATOR,
        ownerProjectId: SPECIALISTS,
        braidIds: [braid.braidId],
      });
    });
  });
});

/** The code a synchronous refusal carries; none when nothing is thrown. */
function thrownBy(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

/** The projects a proof's trace reads may touch, own first. */
function projectsOf(proof: { grants: readonly { projectId?: string }[] }): (string | undefined)[] {
  return proof.grants.map((grant) => grant.projectId);
}

function secondOf(ms: number | undefined): number | undefined {
  return ms === undefined ? undefined : Math.floor(ms / 1000);
}

/** Waits, if needed, until the clock is early in a second, so a short run stays inside it. */
async function earlyInASecond(): Promise<void> {
  const into = Date.now() % 1000;
  if (into > 400) await new Promise((resolve) => setTimeout(resolve, 1000 - into + 5));
}
