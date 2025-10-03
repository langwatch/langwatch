import type { NextApiRequest, NextApiResponse } from "next";
import { deleteTracesRetentionPolicy } from "~/tasks/deleteTracesRetentionPolicy";
import { migrateToColdStorage } from "../../../tasks/cold/moveTracesToColdStorage";
import { prisma } from "../../../server/db";
import { COLD_STORAGE_AGE_DAYS } from "../../../server/elasticsearch";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  let cronApiKey = req.headers.authorization;
  cronApiKey = cronApiKey?.startsWith("Bearer ")
    ? cronApiKey.slice(7)
    : cronApiKey;

  if (cronApiKey !== process.env.CRON_API_KEY) {
    return res.status(401).end();
  }

  try {
    const projectId = req.query.projectId as string | undefined;
    const organizationId = projectId
      ? (
          await prisma.project.findUnique({
            where: {
              id: projectId,
            },
            select: {
              team: {
                select: {
                  organizationId: true,
                },
              },
            },
          })
        )?.team?.organizationId
      : undefined;
    const movedToColdStorage = await migrateToColdStorage(
      COLD_STORAGE_AGE_DAYS,
      organizationId
    );
    const totalDeleted = await deleteTracesRetentionPolicy(projectId);

    res.status(200).json({
      message: "Traces retention period maintenance completed successfully",
      totalDeleted,
      movedToColdStorage: movedToColdStorage?.migrated,
    });
  } catch (error: any) {
    res.status(500).json({
      message: "Error deleting old traces",
      error: error?.message ? error.message.toString() : `${error}`,
    });
  }
}
