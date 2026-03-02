import type { PrismaClient } from "@prisma/client";
import { LicenseHandler } from "./licenseHandler";
import type { ITraceUsageService } from "./licenseHandler";
import { PUBLIC_KEY } from "./constants";
import { LicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { TraceUsageService } from "~/server/traces/trace-usage.service";

/**
 * Factory function for creating a LicenseHandler instance.
 * This is the composition root - wires up concrete implementations.
 *
 * Placed in server.ts (not index.ts) to:
 * 1. Avoid bundling server-only dependencies (TraceUsageService, Elasticsearch) in client code
 * 2. Keep LicenseHandler pure (depends only on interfaces)
 * 3. Centralize DI wiring in one place
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
  const traceUsageService: ITraceUsageService = TraceUsageService.create(prisma);

  return new LicenseHandler({
    prisma,
    publicKey,
    repository,
    traceUsageService,
  });
}
