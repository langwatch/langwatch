import { prisma } from "../../server/db";

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
