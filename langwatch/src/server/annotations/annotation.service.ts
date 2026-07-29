import type { Annotation, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AnnotationRepository,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type UpdateAnnotationInput,
} from "./annotation.repository";

/**
 * An annotator is addressed over the wire as a single prefixed string, so a
 * queue and a user can share one field. The id keeps every character after the
 * prefix — ids contain hyphens of their own.
 */
const annotatorReferenceSchema = z.string().transform((annotator, ctx) => {
  if (annotator.startsWith("queue-") && annotator.length > 6) {
    return { type: "queue" as const, id: annotator.slice(6) };
  }
  if (annotator.startsWith("user-") && annotator.length > 5) {
    return { type: "user" as const, id: annotator.slice(5) };
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid annotator" });
  return z.NEVER;
});

type AnnotatorReference = z.infer<typeof annotatorReferenceSchema>;

export class AnnotationService {
  constructor(private readonly repository: AnnotationRepository) {}

  static create({ prisma }: { prisma: PrismaClient }): AnnotationService {
    return new AnnotationService(new AnnotationRepository(prisma));
  }

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.repository.create(input);
  }

  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.repository.update(input);
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.repository.delete(input);
  }

  async getProjectOrganizationId({
    projectId,
  }: {
    projectId: string;
  }): Promise<string> {
    const organizationId = await this.repository.findProjectOrganizationId({
      projectId,
    });

    if (organizationId === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    return organizationId;
  }

  /**
   * Guards a queue's configuration against cross-tenant references: members
   * must belong to the project's organization and scores to the project.
   */
  async assertQueueConfigurationReferences({
    projectId,
    userIds,
    scoreTypeIds,
  }: {
    projectId: string;
    userIds: string[];
    scoreTypeIds: string[];
  }): Promise<void> {
    const organizationId = await this.getProjectOrganizationId({ projectId });
    const uniqueUserIds = [...new Set(userIds)];
    const uniqueScoreTypeIds = [...new Set(scoreTypeIds)];

    const [userCount, scoreCount] = await Promise.all([
      this.repository.countOrganizationUsers({
        organizationId,
        userIds: uniqueUserIds,
      }),
      this.repository.countAnnotationScores({
        projectId,
        scoreTypeIds: uniqueScoreTypeIds,
      }),
    ]);

    if (userCount !== uniqueUserIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more queue members are not in this organization",
      });
    }
    if (scoreCount !== uniqueScoreTypeIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more annotation scores are not in this project",
      });
    }
  }

  /**
   * Guards queue-item annotators against cross-tenant references: queues must
   * belong to the project and users to the project's organization.
   */
  async assertAnnotatorReferences({
    projectId,
    queueIds,
    userIds,
  }: {
    projectId: string;
    queueIds: string[];
    userIds: string[];
  }): Promise<void> {
    const organizationId = await this.getProjectOrganizationId({ projectId });
    const uniqueQueueIds = [...new Set(queueIds)];
    const uniqueUserIds = [...new Set(userIds)];

    const [queueCount, userCount] = await Promise.all([
      this.repository.countAnnotationQueues({
        projectId,
        queueIds: uniqueQueueIds,
      }),
      this.repository.countOrganizationUsers({
        organizationId,
        userIds: uniqueUserIds,
      }),
    ]);

    if (
      queueCount !== uniqueQueueIds.length ||
      userCount !== uniqueUserIds.length
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more annotators are not available in this project",
      });
    }
  }

  /**
   * Assigns each trace to each annotator, creating the queue item or re-opening
   * an existing one. Cross-tenant references are rejected before anything is
   * written, so a bad annotator in the batch assigns nothing.
   *
   * Annotators are deduplicated before the writes fan out: two upserts racing
   * on the same (trace, annotator) key are what turns a repeated annotator in
   * the request into a unique-constraint violation instead of a no-op.
   */
  async enqueueTracesForAnnotators({
    traceIds,
    projectId,
    annotators,
    userId,
  }: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }): Promise<void> {
    const parsedAnnotators: AnnotatorReference[] = annotators.map(
      (annotator) => {
        const parsed = annotatorReferenceSchema.safeParse(annotator);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid annotator",
          });
        }
        return parsed.data;
      },
    );

    const uniqueAnnotators = [
      ...new Map(
        parsedAnnotators.map((annotator) => [
          `${annotator.type}:${annotator.id}`,
          annotator,
        ]),
      ).values(),
    ];

    await this.assertAnnotatorReferences({
      projectId,
      queueIds: parsedAnnotators
        .filter((annotator) => annotator.type === "queue")
        .map((annotator) => annotator.id),
      userIds: parsedAnnotators
        .filter((annotator) => annotator.type === "user")
        .map((annotator) => annotator.id),
    });

    await Promise.all(
      traceIds.flatMap((traceId) =>
        uniqueAnnotators.map((annotator) =>
          annotator.type === "queue"
            ? this.repository.upsertQueueItemForQueue({
                projectId,
                traceId,
                annotationQueueId: annotator.id,
                createdByUserId: userId,
              })
            : this.repository.upsertQueueItemForUser({
                projectId,
                traceId,
                userId: annotator.id,
                createdByUserId: userId,
              }),
        ),
      ),
    );
  }
}
