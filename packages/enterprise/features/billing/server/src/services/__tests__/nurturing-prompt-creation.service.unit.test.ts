/**
 * What writing a prompt tells Customer.io, and once only for the first one.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterPromptCreated,
  firePromptCreatedNurturing,
} from "../nurturing-prompt-creation.service";
import { setNurturingOrganizationAdminResolver } from "../nurturing-sink";
import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "./support/nurturing-harness";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/** The two reads `afterPromptCreated` makes on its own, and nothing else. */
function prismaCounting(orgPromptCount: number) {
  return {
    project: { findUnique: vi.fn(async () => ({ team: { organizationId: "org-1" } })) },
    llmPromptConfig: { count: vi.fn(async () => orgPromptCount) },
  } as unknown as PrismaClient;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  registerNoNurturingSink();
  setNurturingOrganizationAdminResolver(null);
});

describe("firePromptCreatedNurturing", () => {
  describe("given an organization with no prompts across any project", () => {
    describe("when the first prompt is created", () => {
      /** @scenario "First prompt creation identifies user with has_prompts true" */
      it("identifies them with has_prompts and an org-wide count of one", async () => {
        const sink = registerNurturingSink();

        firePromptCreatedNurturing({ userId: "user-1", projectId: "project-1", orgPromptCount: 1 });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
          userId: "user-1",
          traits: { has_prompts: true, prompt_count: 1 },
        });
      });

      /** @scenario "First prompt creation fires first_prompt_created event" */
      it("tracks first_prompt_created against the project", async () => {
        const sink = registerNurturingSink();

        firePromptCreatedNurturing({ userId: "user-1", projectId: "project-1", orgPromptCount: 1 });
        await settle();

        expect(sink.sentTo("/track")[0]).toMatchObject({
          event: "first_prompt_created",
          properties: { project_id: "project-1" },
        });
      });
    });
  });

  describe("given an organization that already has prompts", () => {
    describe("when another prompt is created in any project", () => {
      /** @scenario "Subsequent prompt creation updates org-wide prompt_count without firing first event" */
      it("updates the org-wide count and tracks nothing", async () => {
        const sink = registerNurturingSink();

        firePromptCreatedNurturing({ userId: "user-1", projectId: "project-2", orgPromptCount: 4 });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
          traits: { has_prompts: true, prompt_count: 4 },
        });
        expect(sink.sentTo("/track")).toHaveLength(0);
      });
    });
  });
});

describe("afterPromptCreated", () => {
  describe("given an organization with no prompts and a prompt written through the REST API", () => {
    describe("when the prompt is saved without an actor in hand", () => {
      /** @scenario "Prompt creation tracked regardless of whether created via platform UI or API" */
      it("resolves the organization admin and reports the milestone all the same", async () => {
        const sink = registerNurturingSink();
        setNurturingOrganizationAdminResolver(async () => ({
          userId: "admin-1",
          organizationId: "org-1",
        }));

        afterPromptCreated({ prisma: prismaCounting(1), projectId: "project-1" });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
          userId: "admin-1",
          traits: { has_prompts: true },
        });
        expect(sink.sentTo("/track")[0]).toMatchObject({ event: "first_prompt_created" });
      });
    });
  });

  describe("given Customer.io is unavailable", () => {
    describe("when a prompt is saved", () => {
      /** @scenario "Prompt creation hook failure does not break the prompt mutation" */
      it("returns normally and reports the failure for observability", async () => {
        const sink = registerNurturingSink({ failing: true });

        expect(() =>
          afterPromptCreated({
            prisma: prismaCounting(1),
            projectId: "project-1",
            userId: "user-1",
          }),
        ).not.toThrow();
        await settle();

        expect(sink.errorReporter.capture).toHaveBeenCalled();
      });
    });
  });
});
