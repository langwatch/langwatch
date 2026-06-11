import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  EmailSuppressionRepository,
  EmailSuppressionRow,
} from "./emailSuppression.repository";

export class PrismaEmailSuppressionRepository
  implements EmailSuppressionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAllForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<EmailSuppressionRow[]> {
    return this.prisma.emailSuppression.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create({
    projectId,
    email,
    triggerId,
    reason,
  }: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }): Promise<EmailSuppressionRow> {
    // Prisma's compound-unique upsert can't target a NULL component (NULLs are
    // distinct in the unique index), so a project-wide row (triggerId === null)
    // relies on the partial unique index (triggerId IS NULL) added by the
    // migration. Attempt the create and treat a unique-violation (P2002) as
    // "already suppressed" — idempotent and race-safe (no findFirst+create gap).
    if (triggerId === null) {
      try {
        return await this.prisma.emailSuppression.create({
          data: { projectId, email, triggerId: null, reason },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existing = await this.prisma.emailSuppression.findFirst({
            where: { projectId, email, triggerId: null },
          });
          if (existing) return existing;
        }
        throw error;
      }
    }
    return this.prisma.emailSuppression.upsert({
      where: {
        projectId_email_triggerId: { projectId, email, triggerId },
      },
      update: {},
      create: { projectId, email, triggerId, reason },
    });
  }

  async delete({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<void> {
    await this.prisma.emailSuppression.deleteMany({ where: { id, projectId } });
  }

  async findMatching({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<EmailSuppressionRow[]> {
    return this.prisma.emailSuppression.findMany({
      where: {
        projectId,
        OR: [{ triggerId: null }, { triggerId }],
      },
    });
  }
}
