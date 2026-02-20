import type { PrismaClient } from "@prisma/client";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { LicenseEnforcementRepository } from "./license-enforcement.repository";
import { LicenseEnforcementService } from "./license-enforcement.service";

// Re-export types and errors for consumers
export { LicenseEnforcementService } from "./license-enforcement.service";
export { LimitExceededError, ProjectNotFoundError } from "./errors";
export { limitTypes, limitTypeSchema } from "./types";
export { LIMIT_TYPE_LABELS, LIMIT_TYPE_DISPLAY_LABELS } from "./constants";
export type { LimitType, LimitCheckResult } from "./types";
export type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
export type { PlanProvider } from "./license-enforcement.service";

// Re-export utilities for router usage
export { getOrganizationIdForProject } from "./utils";
export { enforceLicenseLimit } from "./enforcement.middleware";
export type {
  LicenseEnforcementContext,
  LicenseEnforcementInput,
} from "./enforcement.middleware";

// Re-export license limit guard for member type changes
export {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
} from "./license-limit-guard";
export type { MemberTypeLimits } from "./license-limit-guard";

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
    SubscriptionHandler,
  );
}
