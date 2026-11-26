/**
 * Where LangWatch Judge (preview) may judge: the release flag read for the project's
 * organization alone, and no answer for a project outside one.
 * @see modules/scenario/specs/judge-preview.feature
 */
import { describe, expect, it } from "vitest";

import { judgePreviewAvailabilityFixture } from "../../../../__tests__/support/judge-preview.fixture.ts";

const PROJECT_ID = "project-1";

describe("JudgePreviewAvailabilityService", () => {
  /** @scenario "The flag is read for the project's organization alone" */
  it("reads the release flag for the project's organization, never the project", async () => {
    const flagChecks: unknown[][] = [];
    const availability = judgePreviewAvailabilityFixture({
      isSaas: true,
      isFlagOn: true,
      organizationId: "organization-9",
      flagChecks,
    });

    const answer = await availability.availabilityFor({ projectId: PROJECT_ID });

    expect(answer).toEqual({ isAvailable: true });
    expect(flagChecks).toEqual([
      [
        "release_langwatch_judge_preview",
        { kind: "organization", organizationId: "organization-9" },
      ],
    ]);
  });

  /** @scenario "A project outside an organization is refused" */
  it("is unavailable for a project with no organization, which no rule could name", async () => {
    const availability = judgePreviewAvailabilityFixture({
      isSaas: true,
      isFlagOn: true,
      organizationId: null,
    });

    const answer = await availability.availabilityFor({ projectId: PROJECT_ID });

    expect(answer).toMatchObject({ isAvailable: false });
  });
});
