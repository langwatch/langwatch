import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { JudgePreviewAvailabilityService } from "../../features/judge-preview/services/judge-preview-availability.service.ts";

/**
 * LangWatch Judge (preview) availability over stand-ins: the install is Cloud or not, the
 * release flag is on or off for the project's organization, and the route table can answer a
 * scenario judge or not. Off Cloud no peer is ever asked.
 */
export function judgePreviewAvailabilityFixture({
  isSaas = false,
  isFlagOn = false,
  isConfigured = true,
  organizationId = "organization-1",
  flagChecks = [],
}: {
  isSaas?: boolean;
  isFlagOn?: boolean;
  /** Whether the judge's route table names a turn decision backend. */
  isConfigured?: boolean;
  /** Null is a project with no organization. */
  organizationId?: string | null;
  /** Every flag read, so a suite can assert which organization it was read for. */
  flagChecks?: unknown[][];
} = {}): JudgePreviewAvailabilityService {
  return JudgePreviewAvailabilityService.create({
    isSaas,
    projects: createApiFixture<ProjectApi>({
      findOrganizationId: async () => organizationId ?? void 0,
    }),
    judges: createApiFixture<InstantEvalJudgeApi>({
      isScenarioJudgeConfigured: async () => isConfigured,
    }),
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (...check) => {
        flagChecks.push(check);
        return isFlagOn;
      },
    }),
  });
}
