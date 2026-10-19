/** @see specs/experiments-v3/attachment-inputs.feature */
import type { RequestBoundKey } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { ExperimentAttachmentLimitService } from "../experiment-attachment-limit.service.ts";

const MB = 1024 * 1024;

function setup(answers: Record<string, number>) {
  const asked: { key: RequestBoundKey; organizationId: string }[] = [];
  const limits = ExperimentAttachmentLimitService.create({
    entitlements: {
      requestBound: async (input) => {
        asked.push(input);
        const answer = answers[input.organizationId];
        if (answer === undefined) throw new Error("entitlements unavailable");

        return answer;
      },
    },
    projects: { getOrganizationId: async (projectId) => `organization-of-${projectId}` },
  });

  return { limits, asked, answers };
}

describe("given a run whose cells read attachments", () => {
  describe("when several cells of one project ask for the file limit", () => {
    /** @scenario "The cells of one run ask for the organization's file limit once" */
    it("resolves the organization's limit once and answers it to every cell", async () => {
      const { limits, asked } = setup({ "organization-of-project-1": 64 * MB });

      const answers = await Promise.all(
        Array.from({ length: 5 }, () => limits.maxBytesFor("project-1")),
      );

      expect(answers).toEqual(Array.from({ length: 5 }, () => 64 * MB));
      expect(asked).toEqual([
        { key: "datasetAttachmentBytes", organizationId: "organization-of-project-1" },
      ]);
    });
  });

  describe("when two projects of different organizations ask", () => {
    it("answers each its own organization's limit", async () => {
      const { limits } = setup({
        "organization-of-project-1": 20 * MB,
        "organization-of-project-2": 512 * MB,
      });

      await expect(limits.maxBytesFor("project-1")).resolves.toBe(20 * MB);
      await expect(limits.maxBytesFor("project-2")).resolves.toBe(512 * MB);
    });
  });

  describe("when the lookup fails", () => {
    it("fails that cell and asks again for the next one", async () => {
      const { limits, answers, asked } = setup({});

      await expect(limits.maxBytesFor("project-1")).rejects.toThrow("entitlements unavailable");
      answers["organization-of-project-1"] = 20 * MB;

      await expect(limits.maxBytesFor("project-1")).resolves.toBe(20 * MB);
      expect(asked).toHaveLength(2);
    });
  });
});
