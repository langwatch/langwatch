import type { PrismaClient } from "@prisma/client";
import { LicenseHandler } from "./licenseHandler";
import type { ITraceUsageService } from "./licenseHandler";
import { PUBLIC_KEY } from "./constants";
import { LicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { TraceUsageService } from "~/server/traces/trace-usage.service";
import type { PlanResolver } from "~/server/app-layer/subscription/plan-provider";

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

  // Safety: LicenseHandler only calls TraceUsageService.getCurrentMonthCount
  // and getCountByProjects — never checkLimit — so this resolver is never
  // invoked at runtime. We provide a clear error if that invariant is broken.
  const licenseHandlerPlanResolver: PlanResolver = () => {
    throw new Error(
      "PlanResolver must not be called from within LicenseHandler. " +
        "LicenseHandler owns plan resolution itself.",
    );
  };
  const traceUsageService: ITraceUsageService = TraceUsageService.create(
    prisma,
    licenseHandlerPlanResolver,
  );

  return new LicenseHandler({
    prisma,
    publicKey,
    repository,
    traceUsageService,
  });
}
