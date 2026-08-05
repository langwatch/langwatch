import type { PrismaClient } from "@prisma/client";
import { getApp } from "../app-layer/app";
import { LicenseEnforcementRepository } from "./license-enforcement.repository";
import { LicenseEnforcementService } from "./license-enforcement.service";

export type { PlanProvider } from "../app-layer/subscription/plan-provider";
export { LIMIT_TYPE_DISPLAY_LABELS, LIMIT_TYPE_LABELS } from "./constants";
export { LimitExceededError, ProjectNotFoundError } from "./errors";
export type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
// Re-export types and errors for consumers
export { LicenseEnforcementService } from "./license-enforcement.service";
export type { MemberTypeLimits } from "./license-limit-guard";
// Re-export license limit guard for member type changes
export {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
} from "./license-limit-guard";
export type { LimitCheckResult, LimitType } from "./types";
export { limitTypeSchema, limitTypes } from "./types";
// Re-export utilities for router usage
export { getOrganizationIdForProject } from "./utils";

/**
 * Factory function to create a LicenseEnforcementService.
 *
 * This is the composition root - it wires up all dependencies.
 * Placing it here (not in the service class) follows clean architecture
 * principles where the service doesn't know how it's instantiated.
 *
 * @param prisma - Database client for resource counting
 * @returns Configured LicenseEnforcementService instance
 */
export function createLicenseEnforcementService(
  prisma: PrismaClient,
): LicenseEnforcementService {
  return new LicenseEnforcementService(
    new LicenseEnforcementRepository(prisma),
    getApp().planProvider,
  );
}
