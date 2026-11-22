/**
 * @vitest-environment node
 * The organisation's "Braids enabled" setting through the tRPC door over the composed authz app:
 * off by default, an organisation admin's to change, and while off braid management refuses.
 * @see modules/authz/specs/braids.feature
 */
import { afterEach, describe, expect, it } from "vitest";

import { BRAIDS_ENABLED_CHANGED_ACTION } from "../../services/authz-organization-policy.service.ts";
import {
  braidWorld,
  failureOf,
  ORCHESTRATOR,
  ORG,
  refusalOf,
  SPECIALISTS,
  TEAMS,
} from "./authz-braid-world.fixture.ts";

const ANA = "user_ana";
const TOM = "user_tom";
const FROM_MS = Date.UTC(2026, 9, 1);

type World = Awaited<ReturnType<typeof braidWorld>>;
let worlds: World[] = [];

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

const braidInput = { projectId: SPECIALISTS, readerProjectId: ORCHESTRATOR, fromMs: FROM_MS };
const turn = (made: World, userId: string, braidsEnabled: boolean) =>
  made.as(userId).setBraidsEnabled({ organizationId: ORG, braidsEnabled });

describe("the organisation's Braids setting", () => {
  describe("given an organisation that never turned Braids on", () => {
    it("answers it off on the Braids screen and refuses creating a braid", async () => {
      const made = await world({ braidsEnabled: false });

      await expect(made.as(ANA).getBraidsPolicy({ organizationId: ORG })).resolves.toMatchObject({
        braidsEnabled: false,
      });
      expect(await refusalOf(made.as(ANA).createBraid(braidInput))).toBe("braids_turned_off");
    });
  });

  describe("when tom, a team admin, asks to turn Braids on", () => {
    /** @scenario "Only an organisation admin may turn Braids on or off" */
    it("refuses tom as a permission denial and accepts and audits ana's change", async () => {
      const made = await world({ braidsEnabled: false });
      await made.seat(TOM, { teams: { [TEAMS.specialists]: "admin" } });

      const refusal = await failureOf(turn(made, TOM, true));
      const afterTom = await made.app.getOrganizationPolicy({ organizationId: ORG });
      const accepted = await turn(made, ANA, true);

      expect(refusal).toMatchObject({
        code: "permission_denied",
        meta: { permission: "organization:manage" },
      });
      expect(afterTom.braidsEnabled).toBe(false);
      expect(accepted).toMatchObject({ braidsEnabled: true, updatedByUserId: ANA });
      expect(
        made.auditRows().filter((row) => row.action === BRAIDS_ENABLED_CHANGED_ACTION),
      ).toEqual([
        expect.objectContaining({
          userId: ANA,
          organizationId: ORG,
          metadata: { braidsEnabled: true, previous: false },
        }),
      ]);
    });
  });

  describe("given an organisation below Enterprise", () => {
    /** @scenario "Below Enterprise Braids cannot be turned on" */
    it("refuses ana's change with enterprise_plan_required naming Braids", async () => {
      const made = await world({ enterprise: false, braidsEnabled: false });

      expect(await failureOf(turn(made, ANA, true))).toMatchObject({
        code: "enterprise_plan_required",
        meta: { feature: "BRAIDS" },
      });
      await expect(made.app.getOrganizationPolicy({ organizationId: ORG })).resolves.toMatchObject({
        braidsEnabled: false,
      });
    });
  });

  describe("given a live braid, then Braids turned off", () => {
    /** @scenario "While Braids is turned off, management refuses and removal still works" */
    it("refuses management with braids_turned_off, still lists and removes, and reads the settings", async () => {
      const made = await world();
      const braid = await made.as(ANA).createBraid(braidInput);
      await turn(made, ANA, false);
      const caller = made.as(ANA);

      const refusals = await Promise.all([
        refusalOf(caller.createBraid(braidInput)),
        refusalOf(caller.changeBraid({ ...braidInput, braidId: braid.braidId })),
        refusalOf(caller.listBraidTargets({ projectId: SPECIALISTS, projectIds: [ORCHESTRATOR] })),
        refusalOf(caller.countProjectTraceViewers({ projectId: ORCHESTRATOR })),
      ]);
      const listed = await caller.listBraids({ projectId: SPECIALISTS });
      const settings = await caller.getBraidsPolicy({ organizationId: ORG });
      const removed = await caller.removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId });

      expect(refusals).toEqual(Array.from({ length: 4 }, () => "braids_turned_off"));
      expect(listed.intoOtherProjects.map((each) => each.braidId)).toEqual([braid.braidId]);
      expect(settings).toMatchObject({ braidsEnabled: false });
      expect(removed).toMatchObject({ braidId: braid.braidId });
      expect(await caller.listBraids({ projectId: SPECIALISTS })).toMatchObject({
        intoOtherProjects: [],
      });
    });
  });
});
