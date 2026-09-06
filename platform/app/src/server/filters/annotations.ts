import { prisma } from "../../server/db";

/**
 * The traces a human has annotated in a window, for the trigger filters that
 * watch for them.
 *
 * Every comment counts, including one left on a single span. Whether anyone has
 * touched a trace at all is a different question from what they said about the
 * trace as a whole, and this one answers the first.
 */
export async function getAnnotatedTraceIds({
  projectId,
  startDate,
  endDate,
}: {
  projectId: string;
  startDate: Date;
  endDate: Date;
}) {
  const annotatedTraces = await prisma.annotation.findMany({
    where: {
      projectId: projectId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: { traceId: true },
  });

  const traceIds = annotatedTraces.map((t) => t.traceId);

  return traceIds;
}
