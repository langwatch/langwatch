import { Prisma } from "@langwatch/prisma-client/generated";
import {
  ImpersonationRepository,
  type ImpersonationTarget,
  type ImpersonationWindow,
} from "../../services/impersonation.service";
import type { AdminDatabase } from "../../ports/admin-database.port";

export class PrismaImpersonationRepository extends ImpersonationRepository {
  private constructor(private readonly database: AdminDatabase) {
    super();
  }

  static create(database: AdminDatabase): PrismaImpersonationRepository {
    return new PrismaImpersonationRepository(database);
  }

  async findTarget(userId: string): Promise<ImpersonationTarget | null> {
    return this.database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        deactivatedAt: true,
      },
    });
  }

  async setWindow(sessionId: string, window: ImpersonationWindow): Promise<void> {
    await this.database.session.update({
      where: { id: sessionId },
      data: {
        impersonating: {
          ...window,
          expires: window.expires.toISOString(),
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
