import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { createLicenseEnforcementService } from "./index";
import { LimitExceededError } from "./errors";
import type { LimitType } from "./types";
import { getOrganizationIdForProject } from "./utils";

/**
 * Context type expected by the license enforcement middleware.
 * This matches the standard tRPC context shape.
 */
export interface LicenseEnforcementContext {
  prisma: PrismaClient;
  session: Session;
}

/**
 * Input type that must contain a projectId for license enforcement.
 */
export interface LicenseEnforcementInput {
  projectId: string;
}

/**
 * Enforces license limits for a given resource type.
 *
 * This function encapsulates the common pattern of:
 * 1. Getting the organizationId from the projectId
 * 2. Creating the license enforcement service
 * 3. Calling enforceLimit
 * 4. Mapping LimitExceededError to TRPCError
 *
 * @param ctx - tRPC context containing prisma and session
 * @param projectId - The project ID to check limits for
 * @param limitType - The type of resource being created
 * @throws TRPCError with FORBIDDEN code if limit is exceeded
 */
export async function enforceLicenseLimit(
  ctx: LicenseEnforcementContext,
  projectId: string,
  limitType: LimitType,
): Promise<void> {
  const organizationId = await getOrganizationIdForProject(
    ctx.prisma,
    projectId,
  );
  const enforcement = createLicenseEnforcementService(ctx.prisma);

  try {
    await enforcement.enforceLimit(
      organizationId,
      limitType,
      ctx.session.user,
    );
  } catch (error) {
    if (error instanceof LimitExceededError) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: error.message,
        cause: {
          limitType: error.limitType,
          current: error.current,
          max: error.max,
        },
      });
    }
    throw error;
  }
}
