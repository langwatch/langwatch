import type { PrismaClient } from "@prisma/client";
import { LicenseHandler } from "./licenseHandler";
import type { ITraceUsageService } from "./licenseHandler";
import { PUBLIC_KEY } from "./constants";
import { LicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { getApp } from "~/server/app-layer";

/**
 * Factory function for creating a LicenseHandler instance.
 * This is the composition root - wires up concrete implementations.
 *
 * Placed in server.ts (not index.ts) to:
 * 1. Avoid bundling server-only dependencies in client code
 * 2. Keep LicenseHandler pure (depends only on interfaces)
 * 3. Centralize DI wiring in one place
 *
 * Usage counting is delegated to the orchestrated UsageService (via getApp().usage)
 * which applies UsageMeterPolicy to select the correct counter (traces vs events).
 *
 * @param prisma - PrismaClient instance for database access
 * @param publicKey - Optional public key for license validation (defaults to PUBLIC_KEY)
 * @returns Configured LicenseHandler instance
 */
export function createLicenseHandler(
  prisma: PrismaClient,
  publicKey: string = PUBLIC_KEY,
): LicenseHandler {
  const repository = new LicenseEnforcementRepository(prisma);

  // Lazy proxy: defers to getApp().usage at call time so the app can be
  // fully initialized before the first usage count is requested.
  const usageService: ITraceUsageService = {
    getCurrentMonthCount: (params) =>
      getApp().usage.getCurrentMonthCount(params),
  };

  return new LicenseHandler({
    prisma,
    publicKey,
    repository,
    traceUsageService: usageService,
  });
}
