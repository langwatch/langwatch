import { LicenseHandler, PUBLIC_KEY } from "../../ee/licensing";
import { createLicenseHandler } from "../../ee/licensing/server";
import { prisma } from "./db";

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
