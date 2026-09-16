/**
 * Reviewer corrections stored over Prisma; moved unchanged from the application.
 */
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import {
  TraceEditOverlayRepository,
  type TraceEditOverlayRow,
} from "../trace-edit-overlay.repository.ts";

/**
 * KSUID prefix for corrections; not imported to avoid dragging browser constants.
 */
const TRACE_EDIT_OVERLAY_KSUID_RESOURCE = "traceedit";

/** Only what an attribution line renders. The row is read on every corrected
 *  trace, so it never carries the rest of the User record. */
const AUTHOR_SELECT = { id: true, name: true, image: true } as const;

const WITH_AUTHORS = {
  createdBy: { select: AUTHOR_SELECT },
  updatedBy: { select: AUTHOR_SELECT },
} as const;

/** Prisma's unique-constraint failure, read off the code so it survives a
 *  client instance boundary. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

export class PrismaTraceEditOverlayRepository extends TraceEditOverlayRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaTraceEditOverlayRepository {
    return new PrismaTraceEditOverlayRepository(prisma);
  }

  async findByProjectAndTrace({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<TraceEditOverlayRow | null> {
    return this.prisma.traceEditOverlay.findUnique({
      where: { projectId_traceId: { projectId, traceId } },
      include: WITH_AUTHORS,
    });
  }

  async findAllByProjectAndTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<TraceEditOverlayRow[]> {
    if (traceIds.length === 0) return [];
    return this.prisma.traceEditOverlay.findMany({
      where: { projectId, traceId: { in: traceIds } },
      include: WITH_AUTHORS,
    });
  }

  /**
   * Two-constraint upsert race: both reviewers insert, loser retries on unique violation.
   */
  async upsert({
    projectId,
    traceId,
    patch,
    userId,
  }: {
    projectId: string;
    traceId: string;
    patch: TraceEditOverlayPatch;
    userId: string | null;
  }): Promise<TraceEditOverlayRow> {
    const stored = patch as unknown as Prisma.InputJsonValue;
    try {
      return await this.prisma.traceEditOverlay.upsert({
        where: { projectId_traceId: { projectId, traceId } },
        create: {
          id: generate(TRACE_EDIT_OVERLAY_KSUID_RESOURCE).toString(),
          projectId,
          traceId,
          patch: stored,
          createdById: userId,
          updatedById: userId,
        },
        update: {
          patch: stored,
          updatedById: userId,
        },
        include: WITH_AUTHORS,
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      return this.prisma.traceEditOverlay.update({
        where: { projectId_traceId: { projectId, traceId } },
        data: { patch: stored, updatedById: userId },
        include: WITH_AUTHORS,
      });
    }
  }

  async delete({ projectId, traceId }: { projectId: string; traceId: string }): Promise<void> {
    await this.prisma.traceEditOverlay.deleteMany({
      where: { projectId, traceId },
    });
  }
}
