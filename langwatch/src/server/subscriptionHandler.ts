import { LicenseHandler, PUBLIC_KEY, UNLIMITED_PLAN } from "../../ee/licensing";
import type { PlanInfo } from "../../ee/licensing/planInfo";
import { createLicenseHandler } from "../../ee/licensing/server";
import { env } from "../env.mjs";
import { prisma } from "./db";

// Re-export PlanInfo from canonical location for backward compatibility
export type { PlanInfo } from "../../ee/licensing/planInfo";

// Singleton LicenseHandler instance for self-hosted deployments
let licenseHandler: LicenseHandler | null = null;

/**
 * Gets the singleton LicenseHandler instance.
 * Exported for use by the license router to ensure consistent handler lifecycle.
 */
export function getLicenseHandler(): LicenseHandler {
  if (!licenseHandler) {
    licenseHandler = createLicenseHandler(prisma, PUBLIC_KEY);
  }
  return licenseHandler;
}

export abstract class SubscriptionHandler {
  static async getActivePlan(
    organizationId: string,
    _user?: {
      id: string;
      email?: string | null;
      name?: string | null;
    },
    handler: LicenseHandler = getLicenseHandler(),
  ): Promise<PlanInfo> {
    // When license enforcement is disabled, return unlimited plan
    if (env.LICENSE_ENFORCEMENT_DISABLED) {
      return UNLIMITED_PLAN;
    }

    // Default: enforce license limits (enabled by default)
    return handler.getActivePlan(organizationId);
  }
}
