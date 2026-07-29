import type { NurturingService } from "@ee/billing/nurturing/nurturing.service";
import { vi } from "vitest";
import type { ProjectService } from "~/server/app-layer/projects/project.service";

/**
 * The two doubles every Customer.io nurture subscriber test needs.
 *
 * All three subscribers (trace, simulation, evaluation) take the same pair of
 * collaborators and assert against the same calls, so the doubles live here
 * once. Copied into each suite they drifted the moment either service gained a
 * method — which is exactly when every suite needs the same change.
 */
export function createMockNurturing(): NurturingService {
  return {
    identifyUser: vi.fn().mockResolvedValue(undefined),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    groupUser: vi.fn().mockResolvedValue(undefined),
    batch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NurturingService;
}

export function createMockProjectService(
  overrides: Partial<{ resolveOrgAdmin: ReturnType<typeof vi.fn> }> = {},
): ProjectService {
  return {
    resolveOrgAdmin: vi.fn().mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      firstMessage: false,
    }),
    ...overrides,
  } as unknown as ProjectService;
}
