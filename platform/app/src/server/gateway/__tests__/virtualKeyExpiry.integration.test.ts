/**
 * @vitest-environment node
 *
 * Writing a virtual key's expiration date, against real Postgres: what
 * create stores, the three things an update can mean by the field, what a
 * date already in the past does, and what the key publishes afterwards.
 *
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readHandledError } from "~/features/errors";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  loadTraceDestinationFacts,
  toVirtualKeySnakeDto,
} from "../virtualKey.dto";
import { VirtualKeyService } from "../virtualKey.service";

const suffix = nanoid(8);
const ORG_ID = `org-vkexp-${suffix}`;
const TEAM_ID = `team-vkexp-${suffix}`;
const PROJECT_ID = `proj-vkexp-${suffix}`;
const USER_ID = `usr-vkexp-${suffix}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The code off a rejection, however far it travelled to get here. */
function codeOf(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return readHandledError(error)?.code ?? null;
}

describe("virtual key expiration dates (real PG)", () => {
  const service = VirtualKeyService.create(prisma);

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKEXP ${suffix}`, slug: `vkexp-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `VKEXP Team ${suffix}`,
        slug: `vkexp-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `VKEXP Project ${suffix}`,
        slug: `vkexp-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `vkexp-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vkexp.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  async function mintKey(name: string, expiresAt?: Date | null) {
    const { virtualKey } = await service.create({
      organizationId: ORG_ID,
      name: `${name}-${nanoid(6)}`,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      actorUserId: USER_ID,
      expiresAt: expiresAt ?? null,
    });
    return virtualKey;
  }

  describe("given a key created without an expiration", () => {
    /** @scenario "The drawer offers an expiration and defaults to never" */
    it("stores no date at all", async () => {
      const vk = await mintKey("never");
      expect(vk.expiresAt).toBeNull();
    });
  });

  describe("given a key created with an expiration", () => {
    /** @scenario "Picking a period states the date the key stops working" */
    it("stores the exact instant it was given", async () => {
      const expiresAt = new Date(Date.now() + 7 * DAY_MS);
      const vk = await mintKey("in-a-week", expiresAt);
      expect(vk.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    });

    /** @scenario "The expiration date is published on the key" */
    it("publishes the date while its status stays active", async () => {
      const expiresAt = new Date(Date.now() + DAY_MS);
      const vk = await mintKey("published", expiresAt);
      const dto = toVirtualKeySnakeDto({
        virtualKey: await service.getById(vk.id, ORG_ID).then((k) => k!),
        facts: await loadTraceDestinationFacts({
          client: prisma,
          virtualKeys: [vk],
        }),
      });
      expect(dto.expires_at).toBe(expiresAt.toISOString());
      expect(dto.status).toBe("active");
    });
  });

  describe("when the date given has already passed", () => {
    /** @scenario "An expiration date in the past is refused" */
    it("refuses the create, naming the expiration field", async () => {
      const error = await mintKey(
        "born-dead",
        new Date(Date.now() - 1_000),
      ).catch((err: unknown) => err);
      expect(codeOf(error)).toBe("virtual_key_expiry_in_past");
      expect(
        (error as { meta?: { fieldErrors?: Record<string, string[]> } }).meta
          ?.fieldErrors?.expiresAt,
      ).toEqual(["Pick a date in the future"]);
    });

    /** @scenario "An expiration date in the past is refused when it is written" */
    it("refuses the update too, leaving the stored date alone", async () => {
      const expiresAt = new Date(Date.now() + DAY_MS);
      const vk = await mintKey("keep-mine", expiresAt);

      const error = await service
        .update({
          id: vk.id,
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          expiresAt: new Date(Date.now() - 1_000),
        })
        .catch((err: unknown) => err);
      expect(codeOf(error)).toBe("virtual_key_expiry_in_past");

      const stored = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: vk.id },
      });
      expect(stored.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    });
  });

  describe("when an update states what it means by the field", () => {
    /** @scenario "Extending the date puts an expired key back in service" */
    it("moves the date on a value, clears it on null, and leaves it on absence", async () => {
      const first = new Date(Date.now() + DAY_MS);
      const vk = await mintKey("three-ways", first);
      const bornAt = vk.revision;

      const later = new Date(Date.now() + 30 * DAY_MS);
      const moved = await service.update({
        id: vk.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        expiresAt: later,
      });
      expect(moved.expiresAt?.toISOString()).toBe(later.toISOString());
      // Every write bumps the revision, which is what makes the gateway
      // re-read a key whose date just moved.
      expect(moved.revision > bornAt).toBe(true);

      const untouched = await service.update({
        id: vk.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        name: `${vk.name}-renamed`,
      });
      expect(untouched.expiresAt?.toISOString()).toBe(later.toISOString());

      const cleared = await service.update({
        id: vk.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        expiresAt: null,
      });
      expect(cleared.expiresAt).toBeNull();
    });
  });
});
