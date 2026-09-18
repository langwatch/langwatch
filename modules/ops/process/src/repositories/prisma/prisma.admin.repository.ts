import { Prisma } from "@langwatch/prisma-client/generated";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  ImpersonationRepository,
  type ImpersonationTarget,
  type ImpersonationWindow,
} from "../../services/impersonation.service.ts";
import { fromDate, toDate } from "@langwatch/time";

export type AdminDatabase = PrismaClient;

export class PrismaImpersonationRepository extends ImpersonationRepository {
  private constructor(private readonly database: AdminDatabase) {
    super();
  }

  static create(database: AdminDatabase): PrismaImpersonationRepository {
    return new PrismaImpersonationRepository(database);
  }

  /**
   * Memberships ride along as a NESTED read on purpose: a top-level
   * `organizationUser.findMany` carries no single-organization predicate,
   * so the tenancy guard (ADR-021) refuses it outright.
   */
  async tryFindTarget(userId: string): Promise<ImpersonationTarget | null> {
    const row = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        deactivatedAt: true,
        orgMemberships: {
          where: { organization: { mfaRequired: true } },
          select: { organization: { select: { slug: true } } },
        },
      },
    });
    if (!row) return null;

    const { orgMemberships, deactivatedAt, ...target } = row;
    return {
      ...target,
      deactivatedAt: deactivatedAt ? fromDate(deactivatedAt) : null,
      mfaRequiredOrganizationSlugs: orgMemberships.map(
        (membership) => membership.organization.slug,
      ),
    };
  }

  async hasSecondFactor(userId: string): Promise<boolean> {
    const operator = await this.database.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return operator?.twoFactorEnabled === true;
  }

  async setWindow(sessionId: string, window: ImpersonationWindow): Promise<void> {
    await this.database.session.update({
      where: { id: sessionId },
      data: {
        impersonating: {
          ...window,
          expires: toDate(window.expires).toISOString(),
        },
      },
    });
  }

  async clearWindow(sessionId: string): Promise<void> {
    await this.database.session.update({
      where: { id: sessionId },
      data: { impersonating: Prisma.DbNull },
    });
  }
}

export const ORGANIZATION_SAFE_SELECT = {
  id: true,
  name: true,
  phoneNumber: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  usageSpendingMaxLimit: true,
  signupData: true,
  signedDPA: true,
  useCustomS3: true,
  sentPlanLimitAlert: true,
  ssoDomain: true,
  ssoProvider: true,
  promoCode: true,
  stripeCustomerId: true,
  currency: true,
  pricingModel: true,
  license: true,
  licenseExpiresAt: true,
  licenseLastValidatedAt: true,
} as const satisfies Prisma.OrganizationSelect;

export const PROJECT_SAFE_SELECT = {
  id: true,
  name: true,
  slug: true,
  apiKey: true,
  teamId: true,
  language: true,
  framework: true,
  firstMessage: true,
  integrated: true,
  createdAt: true,
  updatedAt: true,
  userLinkTemplate: true,
  traceSharingEnabled: true,
  archivedAt: true,
} as const satisfies Prisma.ProjectSelect;
