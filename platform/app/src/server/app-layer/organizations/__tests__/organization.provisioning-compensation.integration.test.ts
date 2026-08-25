/**
 * @vitest-environment node
 *
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 *
 * The organization and its team commit before provisioning finishes setting
 * them up, and the caller has no id to compensate with until the call returns.
 * A failure after that commit therefore has to be undone here or nowhere: what
 * it would otherwise leave is an organization with no bootstrap key, holding a
 * slug that answers every retry with a 409 until somebody reaches the database
 * directly.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PromptService } from "@langwatch/prompt-contract";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { OrganizationService } from "../organization.service";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

const SEEDING_FAILURE = "prompt tag seeding is unavailable";

/** A tag repository whose seeding is down, recording who it was asked about. */
function buildFailingTagRepository(seenOrganizationIds: string[]) {
  return {
    seedTagsForOrganization: vi.fn(
      async ({ organizationId }: { organizationId: string }) => {
        seenOrganizationIds.push(organizationId);
        throw new Error(SEEDING_FAILURE);
      },
    ),
  } as Pick<PromptService, "seedTagsForOrganization">;
}

/** A tag repository that works, for the retry half of the scenario. */
function buildWorkingTagRepository() {
  return {
    seedTagsForOrganization: vi.fn(async () => {}),
  } as Pick<PromptService, "seedTagsForOrganization">;
}

describe("OrganizationService.createForProvisioning", () => {
  const ns = `prov-comp-${nanoid(8)}`;
  const slug = `--test-org-${ns}`;
  const name = `Provisioning Compensation ${ns}`;
  const repo = new PrismaOrganizationRepository(prisma);

  let retriedOrganizationId: string | undefined;

  afterAll(async () => {
    if (!retriedOrganizationId) return;
    await cleanupTestRows(prisma, [
      ["promptTag", { organizationId: retriedOrganizationId }],
      ["team", { organizationId: retriedOrganizationId }],
      ["organization", { id: retriedOrganizationId }],
    ]);
  });

  describe("given the setup that follows the organization write fails", () => {
    /** @scenario Provisioning that fails while setting the organization up leaves nothing behind */
    it("leaves no organization or team behind, and the slug provisions afterwards", async () => {
      const attempted: string[] = [];
      const failing = new OrganizationService(repo, buildFailingTagRepository(attempted));

      await expect(failing.createForProvisioning({ name, slug })).rejects.toThrow(
        SEEDING_FAILURE,
      );

      // The failure has to have happened after the organization committed,
      // or the test would pass without exercising the compensation at all.
      expect(attempted).toHaveLength(1);
      const orphanedId = attempted[0]!;

      expect(
        await prisma.organization.findUnique({ where: { id: orphanedId } }),
      ).toBeNull();
      expect(await prisma.team.count({ where: { organizationId: orphanedId } })).toBe(0);
      expect(await prisma.organization.findFirst({ where: { slug } })).toBeNull();

      const retried = await new OrganizationService(
        repo,
        buildWorkingTagRepository(),
      ).createForProvisioning({ name, slug });
      retriedOrganizationId = retried.organization.id;

      expect(retried.organization.id).not.toBe(orphanedId);
      expect(
        await prisma.organization.findUnique({
          where: { id: retried.organization.id },
        }),
      ).not.toBeNull();
    });
  });
});
