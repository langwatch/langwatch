import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { JudgePreviewAvailabilityService } from "../../features/judge-preview/services/judge-preview-availability.service.ts";

/**
 * LangWatch Judge (preview) availability over stand-ins: the install is Cloud or not, and the
 * release flag is on or off for the project's organization. Off Cloud no peer is ever asked.
 */
export function judgePreviewAvailabilityFixture({
  isSaas = false,
  isFlagOn = false,
  organizationId = "organization-1",
  flagChecks = [],
}: {
  isSaas?: boolean;
  isFlagOn?: boolean;
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
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (...check) => {
        flagChecks.push(check);
        return isFlagOn;
      },
    }),
  });
}
