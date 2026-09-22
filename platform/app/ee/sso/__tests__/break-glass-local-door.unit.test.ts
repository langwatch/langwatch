import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The env this deployment reports. Declared before the imports below because
 * the method policy reads it at call time, and the whole question here is what
 * a DIFFERENT deployment answers.
 */
const deployment = vi.hoisted(() => ({
  NEXTAUTH_PROVIDER: "email" as string,
  IS_SAAS: false as boolean,
}));
vi.mock("~/env.mjs", () => ({ env: deployment }));

import type { PrismaClient } from "~/generated/prisma/client";
import { localSignInMethods } from "~/server/app-layer/identity/signin-method-policy";
import {
  breakGlassHolderEligibility,
  LocalDoorBreakGlassBinding,
  RequiresLocalDoorAndBinding,
} from "../break-glass-binding";
import { migrationBlockers } from "../sso-migration.rules";
import { countUsableWaysBackIn } from "../sso-migration-evidence.prisma.repository";
import { PrismaSsoOrganizationMemberLookup } from "../sso-self-serve-adapters";

/**
 * A WAY BACK IN THAT CAN ACTUALLY BE WALKED.
 *
 * The setup screen promises that the person holding a grant "can sign in with
 * a password even after single sign-on is on". Three things have to be true
 * for that promise to hold, and each was once assumed:
 *
 *   1. the deployment mounts a password door at all;
 *   2. the check that guards activation reads whether it did, rather than a
 *      constant naming the door's shape;
 *   3. the named person holds a password.
 *
 * Spec: specs/identity/sso-activation.feature, "A way back in that can
 * actually be walked".
 */

const ORG = "org_acme";
const ANA = "user_ana";
const BEN = "user_ben";

beforeEach(() => {
  deployment.NEXTAUTH_PROVIDER = "email";
  deployment.IS_SAAS = false;
});

describe("given a deployment that mounts no password door", () => {
  beforeEach(() => {
    // The hosted product brokering sign-in through another provider, which is
    // exactly the shape of an organization being migrated off Auth0. The
    // email/password routes are not mounted, so there is no local door.
    deployment.NEXTAUTH_PROVIDER = "auth0";
    deployment.IS_SAAS = true;
  });

  /** @scenario "A deployment that mounts no password door cannot promise a way back in" */
  it("refuses to report a local door, so activation's precondition cannot pass", async () => {
    expect(localSignInMethods()).toEqual([]);

    // Composed exactly as the composition root composes it — no argument, so
    // the default is what answers. It used to read a constant that is never
    // empty and therefore said "there is a door" on every deployment there
    // has ever been.
    const door = new LocalDoorBreakGlassBinding();

    await expect(door.hasLiveBinding({ organizationId: ORG })).resolves.toBe(
      false,
    );
    await expect(
      door.reserveActivationRecovery({ organizationId: ORG }),
    ).resolves.toBe(false);
  });

  /** @scenario "A deployment that mounts no password door cannot promise a way back in" */
  it("refuses even when somebody has been named, because the grant has no door to open", async () => {
    const namedSomebody: ConstructorParameters<
      typeof RequiresLocalDoorAndBinding
    >[0]["bindings"] = {
      hasLiveBinding: vi.fn(async () => true),
      reserveActivationRecovery: vi.fn(async () => true),
    };
    const port = new RequiresLocalDoorAndBinding({
      localDoor: new LocalDoorBreakGlassBinding(),
      bindings: namedSomebody,
    });

    // A binding on an installation that mounts no local method names somebody
    // who cannot actually sign in. Both halves, or neither.
    await expect(port.hasLiveBinding({ organizationId: ORG })).resolves.toBe(
      false,
    );
  });

  it("keeps the door on a self-hosted deployment, where the routes always mount", async () => {
    deployment.IS_SAAS = false;

    expect(localSignInMethods()).not.toEqual([]);
    await expect(
      new LocalDoorBreakGlassBinding().hasLiveBinding({ organizationId: ORG }),
    ).resolves.toBe(true);
  });
});

describe("given somebody is being granted a way back in", () => {
  const eligibility = ({
    administrators,
    passwordHolders,
  }: {
    administrators: string[];
    passwordHolders: string[];
  }) =>
    breakGlassHolderEligibility({
      isAdministrator: async ({ userId }) => administrators.includes(userId),
      holdsPassword: async ({ userId }) => passwordHolders.includes(userId),
    });

  /** @scenario "A way back in names somebody who holds a password, not merely somebody senior" */
  it("refuses an administrator who holds no password", async () => {
    // Every administrator of an organization moving off a brokered provider
    // looks like this: senior enough to be trusted with the door, holding no
    // key, because their password lived at the provider.
    const eligible = eligibility({
      administrators: [ANA],
      passwordHolders: [],
    });

    await expect(eligible({ organizationId: ORG, userId: ANA })).resolves.toBe(
      false,
    );
  });

  /** @scenario "A way back in names somebody who holds a password, not merely somebody senior" */
  it("accepts an administrator who holds one", async () => {
    const eligible = eligibility({
      administrators: [ANA],
      passwordHolders: [ANA],
    });

    await expect(eligible({ organizationId: ORG, userId: ANA })).resolves.toBe(
      true,
    );
  });

  /** @scenario "A way back in names somebody who holds a password, not merely somebody senior" */
  it("still refuses somebody who holds a password but is not an administrator", async () => {
    // The password half never stands in for the seniority half. Granting a
    // door the rest of the organization does not have is a decision of the
    // same weight as making somebody an administrator.
    const eligible = eligibility({
      administrators: [],
      passwordHolders: [BEN],
    });

    await expect(eligible({ organizationId: ORG, userId: BEN })).resolves.toBe(
      false,
    );
  });
});

describe("given the administrator is choosing who to grant one to", () => {
  /** @scenario "The people offered a way back in are the ones who could use it" */
  it("says of each candidate whether they could use it", async () => {
    const prisma = {
      organizationUser: {
        findMany: vi.fn(async () => [
          { user: { id: ANA, name: "Ana", email: "ana@acme.com" } },
          { user: { id: BEN, name: "Ben", email: "ben@acme.com" } },
        ]),
      },
    } as unknown as PrismaClient;
    const lookup = new PrismaSsoOrganizationMemberLookup(
      prisma,
      async ({ userId }) => userId === ANA,
    );

    const candidates = await lookup.findAdministrators({
      organizationId: ORG,
    });

    // Both are listed rather than one being silently dropped: a name missing
    // from a picker teaches nobody what they would have to do first.
    expect(candidates).toEqual([
      expect.objectContaining({ userId: ANA, holdsPassword: true }),
      expect.objectContaining({ userId: BEN, holdsPassword: false }),
    ]);
  });
});

describe("given the migration is being checked for what is blocking it", () => {
  const settled = {
    selectedRoute: "direct" as const,
    testSignInDone: true,
    waitingCount: 0,
    deactivatedOnPreviousCount: 0,
    quietComplete: true,
    sharedLegacyIdentifiers: false,
  };

  /** @scenario "Finalizing counts the ways back in that can actually be walked" */
  it("counts only the grants whose holder holds a password", async () => {
    const usable = await countUsableWaysBackIn({
      holders: [{ userId: ANA }, { userId: BEN }],
      holdsPassword: async ({ userId }) => userId === ANA,
    });

    expect(usable).toBe(1);
  });

  /** @scenario "Finalizing counts the ways back in that can actually be walked" */
  it("blocks finalizing when the only unexpired grant belongs to somebody with no password", async () => {
    const liveRecoveryCount = await countUsableWaysBackIn({
      holders: [{ userId: BEN }],
      holdsPassword: async () => false,
    });

    const blockers = migrationBlockers({ ...settled, liveRecoveryCount });

    // The grant is live, unexpired and unsuperseded, and it opens nothing.
    // Counting grants let an organization finalize with no way back in.
    expect(blockers.map((blocker) => blocker.code)).toContain(
      "recovery-path-missing",
    );
  });

  it("stops blocking once somebody who holds a password is granted one", async () => {
    const liveRecoveryCount = await countUsableWaysBackIn({
      holders: [{ userId: ANA }],
      holdsPassword: async () => true,
    });

    expect(
      migrationBlockers({ ...settled, liveRecoveryCount }).map(
        (blocker) => blocker.code,
      ),
    ).not.toContain("recovery-path-missing");
  });

  /** @scenario "The ask to set a password lands while the old provider can still sign somebody in" */
  it("tells the administrator what to do, while they can still do it", async () => {
    const [blocker] = migrationBlockers({
      ...settled,
      liveRecoveryCount: 0,
    }).filter((candidate) => candidate.code === "recovery-path-missing");

    // The remedy, not only the complaint: setting a first password needs a
    // live session, so the ask has to land while the provider being replaced
    // still works. The migration screen is where it lands.
    expect(blocker?.message).toContain("set a password");
    expect(blocker?.message).toContain("still signed in");
  });
});
