/**
 * @vitest-environment node
 * Braid management behind `release_braids`, through the tRPC door over the composed authz app:
 * every management procedure refuses while it is off, and braids already made keep applying.
 * @see modules/authz/specs/braids-release-flag.feature
 */
import { BRAIDS_FLAG } from "@langwatch/authz-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  braidWorld,
  ORCHESTRATOR,
  ORG,
  refusalOf,
  SPECIALISTS,
  TEAMS,
} from "./authz-braid-world.fixture.ts";

const ANA = "user_ana";
const SAM = "user_sam";
const FROM_MS = Date.UTC(2026, 9, 1);
const WEB = 'attributes["orchestrator"] == "web"';

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

/** Every refused management procedure the screens call; removing a braid is not one of them. */
function everyManagementCall({ as }: World, userId: string, braidId: string) {
  const caller = as(userId);
  return {
    listBraids: caller.listBraids({ projectId: SPECIALISTS }),
    createBraid: caller.createBraid(braidInput),
    changeBraid: caller.changeBraid({ ...braidInput, braidId }),
    listOrganizationBraids: caller.listOrganizationBraids({ organizationId: ORG }),
    listBraidTargets: caller.listBraidTargets({
      projectId: SPECIALISTS,
      projectIds: [ORCHESTRATOR],
    }),
    countProjectTraceViewers: caller.countProjectTraceViewers({ projectId: ORCHESTRATOR }),
    getBraidsPolicy: caller.getBraidsPolicy({ organizationId: ORG }),
    setBraidsPolicy: caller.setBraidsPolicy({
      organizationId: ORG,
      braidsOrganizationAdminsOnly: true,
    }),
  };
}

describe("braid management behind release_braids", () => {
  describe("given release_braids is off for the organisation", () => {
    /** @scenario "With release_braids off every braid management procedure refuses with braids_not_enabled" */
    it("refuses every management procedure with braids_not_enabled and writes no braid", async () => {
      const made = await world({ braidsReleased: false });

      const calls = everyManagementCall(made, ANA, "braid_unknown");
      const refusals = Object.fromEntries(
        await Promise.all(
          Object.entries(calls).map(async ([name, call]) => [name, await refusalOf(call)]),
        ),
      );

      expect(refusals).toEqual(
        Object.fromEntries(Object.keys(calls).map((name) => [name, "braids_not_enabled"])),
      );
      expect(made.braidRows()).toEqual([]);
    });
  });

  describe("given release_braids is on for the organisation", () => {
    /** @scenario "With release_braids on braid management answers again" */
    it("creates a braid and lists it", async () => {
      const made = await world();

      const braid = await made.as(ANA).createBraid(braidInput);

      await expect(made.as(ANA).listOrganizationBraids({ organizationId: ORG })).resolves.toEqual([
        expect.objectContaining({ braidId: braid.braidId }),
      ]);
      await expect(made.as(ANA).getBraidsPolicy({ organizationId: ORG })).resolves.toMatchObject({
        braidsOrganizationAdminsOnly: false,
      });
    });
  });

  describe("given a live braid, then release_braids switched off", () => {
    /** @scenario "Existing braids still apply to trace reads while release_braids is off" */
    it("still carries the owner's spans on the reader's next read", async () => {
      const made = await world();
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const braid = await made.as(ANA).createBraid(braidInput);

      made.flags.withhold({ flag: BRAIDS_FLAG, organizationId: ORG });
      const proof = await made.mint(SAM, ORCHESTRATOR);

      expect(proof.grants.map((grant) => grant.projectId)).toEqual([ORCHESTRATOR, SPECIALISTS]);
      expect(proof.grants[1]).toMatchObject({ projectId: SPECIALISTS, via: [braid.braidId] });
    });

    /** @scenario "Removing a braid still works while release_braids is off" */
    it("removes it through the screen's route, and the reader's next read no longer carries it", async () => {
      const made = await world();
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const braid = await made.as(ANA).createBraid(braidInput);

      made.flags.withhold({ flag: BRAIDS_FLAG, organizationId: ORG });
      const removed = await made.as(ANA).removeBraid({
        projectId: SPECIALISTS,
        braidId: braid.braidId,
      });
      const proof = await made.mint(SAM, ORCHESTRATOR);

      expect(removed).toEqual({ braidId: braid.braidId });
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([ORCHESTRATOR]);
      await expect(refusalOf(made.as(ANA).createBraid(braidInput))).resolves.toBe(
        "braids_not_enabled",
      );
    });

    /** @scenario "General authz reads peers ask still answer while release_braids is off" */
    it("answers the policy and the member count to peers, while the screen's routes refuse", async () => {
      const made = await world();
      made.flags.withhold({ flag: BRAIDS_FLAG, organizationId: ORG });

      await expect(made.app.getOrganizationPolicy({ organizationId: ORG })).resolves.toMatchObject({
        braidsOrganizationAdminsOnly: false,
      });
      await expect(
        made.app.countProjectMembersHolding({ projectId: ORCHESTRATOR, permission: "traces:view" }),
      ).resolves.toMatchObject({ exact: true });
      await expect(refusalOf(made.as(ANA).getBraidsPolicy({ organizationId: ORG }))).resolves.toBe(
        "braids_not_enabled",
      );
      await expect(
        refusalOf(made.as(ANA).countProjectTraceViewers({ projectId: ORCHESTRATOR })),
      ).resolves.toBe("braids_not_enabled");
    });

    /** @scenario "A trace read still shows an existing braid's matched conditions while braids are off" */
    it("answers the trace read's listBraids with the braid and its condition, while the screen's route refuses", async () => {
      const made = await world();
      const braid = await made.as(ANA).createBraid({ ...braidInput, where: WEB });

      made.flags.withhold({ flag: BRAIDS_FLAG, organizationId: ORG });

      await expect(made.app.listBraids({ projectId: ORCHESTRATOR })).resolves.toMatchObject({
        fromOtherProjects: [
          expect.objectContaining({
            braidId: braid.braidId,
            ownerProjectId: SPECIALISTS,
            where: WEB,
          }),
        ],
      });
      await expect(refusalOf(made.as(ANA).listBraids({ projectId: ORCHESTRATOR }))).resolves.toBe(
        "braids_not_enabled",
      );
    });
  });
});
