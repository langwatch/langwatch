/**
 * The guided onboarding REST family through a project credential: the state
 * read and the path completion land on the project's organization.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

describe("Feature: guided onboarding REST family", () => {
  let organization: Organization;
  let team: Team;
  let project: Project;

  const get = (path: string) =>
    app.request(path, { headers: { "X-Auth-Token": project.apiKey } });
  const post = (path: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "X-Auth-Token": project.apiKey,
        "Content-Type": "application/json",
      },
    });

  beforeAll(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({});

    organization = await prisma.organization.create({
      data: {
        name: "ACME Guided",
        slug: `acme-guided-${nanoid()}`,
        signupData: {
          onboardingVariant: "guided",
          guidedOnboarding: {
            paths: ["llmops", "gateway"],
            currentPath: "llmops",
            donePaths: [],
          },
        },
      },
    });
    team = await prisma.team.create({
      data: {
        name: "Guided Team",
        slug: `guided-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await resetApp();
  });

  describe("given a project whose organization recorded llmops and gateway", () => {
    /** @scenario "the REST route reads the guided state of the project's organization" */
    it("answers the state with both paths", async () => {
      const response = await get("/api/v1/onboarding/guided");

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        paths: ["llmops", "gateway"],
        currentPath: "llmops",
        donePaths: [],
      });
    });
  });

  describe("when the llmops path is completed with that project's credential", () => {
    /** @scenario "the REST route completes a path for the project's organization" */
    it("lists llmops among the organization's done paths", async () => {
      const response = await post(
        "/api/v1/onboarding/guided/paths/llmops/complete",
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ donePaths: ["llmops"] });
      expect(body.currentPath).toBeUndefined();

      const stored = await prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
        select: { signupData: true },
      });
      expect(stored.signupData).toMatchObject({
        onboardingVariant: "guided",
        guidedOnboarding: { donePaths: ["llmops"] },
      });
    });

    it("refuses a path the product does not know with the named code", async () => {
      const response = await post(
        "/api/v1/onboarding/guided/paths/billing/complete",
      );

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toMatchObject({ code: "guided_onboarding_path_unknown" });
    });
  });

  describe("given no credential", () => {
    it("refuses the read", async () => {
      const response = await app.request("/api/v1/onboarding/guided");
      expect(response.status).toBe(401);
    });
  });
});
