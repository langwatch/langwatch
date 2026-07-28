import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  EmailSuppressionNameLookupRepository,
  EmailSuppressionRepository,
  EmailSuppressionRow,
  UnsubscribeNames,
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
    // Prisma's upsert cannot target a partial unique index (WHERE clause on a
    // non-null column), which is what `projectId_email_triggerId` resolves to
    // when triggerId IS NOT NULL. Using the same create + catch-P2002 +
    // findFirst pattern as the null branch keeps idempotency without relying on
    // Prisma's native INSERT … ON CONFLICT inference.
    try {
      return await this.prisma.emailSuppression.create({
        data: { projectId, email, triggerId, reason },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.emailSuppression.findFirst({
          where: { projectId, email, triggerId },
        });
        if (existing) return existing;
      }
      throw error;
    }
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

export class PrismaEmailSuppressionNameLookupRepository
  implements EmailSuppressionNameLookupRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async lookupNames({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string | null;
  }): Promise<UnsubscribeNames | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: { name: true },
    });
    if (!project) return null;
    const trigger =
      triggerId != null
        ? await this.prisma.trigger.findFirst({
            where: { id: triggerId, projectId },
            select: { name: true },
          })
        : null;
    return {
      projectName: project.name,
      triggerName: trigger?.name ?? null,
    };
  }

  async findTriggerNames({
    projectId,
    triggerIds,
  }: {
    projectId: string;
    triggerIds: string[];
  }): Promise<Map<string, string>> {
    if (triggerIds.length === 0) return new Map();
    const triggers = await this.prisma.trigger.findMany({
      where: { id: { in: triggerIds }, projectId },
      select: { id: true, name: true },
    });
    return new Map(triggers.map((t) => [t.id, t.name]));
  }
}
