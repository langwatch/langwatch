import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient, TraceEditOverlay } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { TraceEditOverlayPatch } from "./traceEditOverlay.schemas";

/** Only what an attribution line renders. The row is read on every corrected
 *  trace, so it never carries the rest of the User record. */
const AUTHOR_SELECT = { id: true, name: true, image: true } as const;

export interface TraceEditOverlayAuthor {
  id: string;
  name: string | null;
  image: string | null;
}

export type TraceEditOverlayRow = TraceEditOverlay & {
  createdBy: TraceEditOverlayAuthor | null;
  updatedBy: TraceEditOverlayAuthor | null;
};

const WITH_AUTHORS = {
  createdBy: { select: AUTHOR_SELECT },
  updatedBy: { select: AUTHOR_SELECT },
} as const;

/** Prisma's unique-constraint failure, read off the code so it survives a
 *  client instance boundary. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export class TraceEditOverlayRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
   * The row has a primary key as well as its (projectId, traceId) unique, and
   * Prisma cannot push a two-constraint upsert down to a single INSERT ... ON
   * CONFLICT; it compiles to a SELECT followed by an INSERT. Two reviewers
   * saving the first correction for the same trace at the same moment therefore
   * both decide to insert, and the loser gets a unique violation. The loser
   * wanted the row to hold its patch, which is exactly an update, so it retries
   * as one instead of surfacing an error the reviewer cannot act on.
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
          id: generate(KSUID_RESOURCES.TRACE_EDIT_OVERLAY).toString(),
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

  async delete({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<void> {
    await this.prisma.traceEditOverlay.deleteMany({
      where: { projectId, traceId },
    });
  }
}
