import { LicenseHandler, PUBLIC_KEY, UNLIMITED_PLAN } from "../../ee/licensing";
import { env } from "../env.mjs";
import { prisma } from "./db";

export type PlanInfo = {
  type: string;
  name: string;
  free: boolean;
  trialDays?: number;
  daysSinceCreation?: number;
  overrideAddingLimitations?: boolean;
  maxMembers: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  maxWorkflows: number;
  canPublish: boolean;
  userPrice?: {
    USD: number;
    EUR: number;
  };
  tracesPrice?: {
    USD: number;
    EUR: number;
  };
  prices: {
    USD: number;
    EUR: number;
  };
};

// Singleton LicenseHandler instance for self-hosted deployments
let licenseHandler: LicenseHandler | null = null;

function getLicenseHandler(): LicenseHandler {
  if (!licenseHandler) {
    licenseHandler = new LicenseHandler({
      prisma,
      licenseEnforcementEnabled: env.LICENSE_ENFORCEMENT_ENABLED ?? false,
      publicKey: PUBLIC_KEY,
    });
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
  ): Promise<PlanInfo> {
    // When license enforcement is enabled, delegate to LicenseHandler
    if (env.LICENSE_ENFORCEMENT_ENABLED) {
      return getLicenseHandler().getActivePlan(organizationId);
    }

    // Default: return unlimited plan (backward compatible)
    return UNLIMITED_PLAN;
  }
}
