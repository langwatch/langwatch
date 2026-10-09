/**
 * @vitest-environment node
 *
 * The frontend flag procedure against a real Postgres and the real flag
 * store: a stored email domain rule reaches a signed-in user at that domain
 * through the session's email, and leaves a user at another domain on the
 * row-level default. The read is shaped like the welcome flow's, with no
 * project and no organization, because that is the read that picks the
 * guided onboarding variant before any organization exists.
 *
 * @see specs/ops/internal-feature-flags.feature
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import { getFeatureFlagStore, parseRules } from "~/server/featureFlag";
import { createInnerTRPCContext } from "../../trpc";
import { featureFlagRouter } from "../featureFlag";

const FLAG = "experiment_onboarding_langy_guided";
const suffix = nanoid(8);
const TEAM_DOMAIN = `acme-${suffix}.com`;

type SeededUser = { id: string; email: string | null };

const createdUserIds: string[] = [];

async function seedUser(email: string): Promise<SeededUser> {
  const user = await prisma.user.create({
    data: { name: `QA ${suffix}`, email },
  });
  createdUserIds.push(user.id);
  return user;
}

function callerFor(user: SeededUser) {
  return featureFlagRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: user.id, email: user.email }, expires: "1" },
      permissionChecked: false,
    }) as never,
  );
}

/** The welcome flow's read: before any organization or project exists. */
function readAsWelcomeFlow(user: SeededUser) {
  return callerFor(user).isEnabled({
    flag: FLAG,
    projectId: null,
    organizationId: null,
  });
}

describe("featureFlag.isEnabled with an email domain rule", () => {
  const store = getFeatureFlagStore();
  let previousRow: {
    enabled: boolean;
    rules: unknown;
    lastEditedBy: string | null;
  } | null = null;
  let teamMember: SeededUser;
  let outsider: SeededUser;

  beforeAll(async () => {
    // Env overrides and the force list would answer before any rule.
    vi.stubEnv("FEATURE_FLAG_FORCE_ENABLE", "");
    vi.stubEnv(FLAG.toUpperCase(), "");

    previousRow = await prisma.featureFlag.findUnique({
      where: { key: FLAG },
      select: { enabled: true, rules: true, lastEditedBy: true },
    });
    await store.setRules(
      FLAG,
      [{ match: { emailDomain: TEAM_DOMAIN }, enabled: true }],
      null,
    );

    teamMember = await seedUser(`qa-${suffix}@${TEAM_DOMAIN}`);
    outsider = await seedUser(`qa-${suffix}@example.com`);
  });

  afterAll(async () => {
    if (previousRow) {
      await store.set(FLAG, previousRow.enabled, previousRow.lastEditedBy);
      await store.setRules(
        FLAG,
        parseRules(previousRow.rules),
        previousRow.lastEditedBy,
      );
    } else {
      await store.clear(FLAG, null);
    }
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    vi.unstubAllEnvs();
  });

  describe("given the flag's only rule enables it for users at the team's domain", () => {
    describe("when a signed-in user at that domain reads it with no project and no organization", () => {
      /** @scenario "the frontend flag procedure resolves an email domain rule for the signed-in user" */
      /** @scenario "a fresh account at the team's email domain lands in the guided flow with only a domain rule set" */
      it("resolves enabled from the session's email alone", async () => {
        await expect(readAsWelcomeFlow(teamMember)).resolves.toEqual({
          enabled: true,
        });
      });
    });

    describe("when a signed-in user at another domain reads it", () => {
      it("resolves to the row-level default, which is off", async () => {
        await expect(readAsWelcomeFlow(outsider)).resolves.toEqual({
          enabled: false,
        });
      });
    });

    describe("when the domain is compared against a differently cased email", () => {
      it("still matches", async () => {
        const upper = {
          id: teamMember.id,
          email: `QA-${suffix}@${TEAM_DOMAIN.toUpperCase()}`,
        };
        await expect(readAsWelcomeFlow(upper)).resolves.toEqual({
          enabled: true,
        });
      });
    });
  });
});
