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

/** Every braid management procedure the screens call, asked once each by `userId`. */
function everyManagementCall({ as }: World, userId: string, braidId: string) {
  const caller = as(userId);
  return {
    listBraids: caller.listBraids({ projectId: SPECIALISTS }),
    createBraid: caller.createBraid(braidInput),
    changeBraid: caller.changeBraid({ ...braidInput, braidId }),
    removeBraid: caller.removeBraid({ projectId: SPECIALISTS, braidId }),
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
    it("still carries the owner's spans on the reader's next read, and refuses removing it", async () => {
      const made = await world();
      await made.seat(SAM, { teams: { [TEAMS.orchestrator]: "member" } });
      const braid = await made.as(ANA).createBraid(braidInput);

      made.flags.withhold({ flag: BRAIDS_FLAG });
      const proof = await made.mint(SAM, ORCHESTRATOR);

      expect(proof.grants.map((grant) => grant.projectId)).toEqual([ORCHESTRATOR, SPECIALISTS]);
      expect(proof.grants[1]).toMatchObject({ projectId: SPECIALISTS, via: [braid.braidId] });
      await expect(
        refusalOf(made.as(ANA).removeBraid({ projectId: SPECIALISTS, braidId: braid.braidId })),
      ).resolves.toBe("braids_not_enabled");
    });
  });
});
