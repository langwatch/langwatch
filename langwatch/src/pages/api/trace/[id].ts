import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "~/server/db";

import {
  getTraceById,
  getEvaluationsMultiple,
  getSpansForTraceIds,
} from "~/server/api/routers/traces";
import { elasticSearchTraceCheckToUserInterfaceEvaluation } from "../../../server/tracer/utils";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }
  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  const traceId = req.query.id as string;

  const traceDetails = await getTraceById({
    projectId: project?.id,
    traceId,
  });

  const spans = Object.values(await getSpansForTraceIds(project?.id, [traceId])).flat();

  const evaluations = await getEvaluationsMultiple({
    projectId: project?.id,
    traceIds: [traceId],
  });
  const evaluations_ = Object.values(evaluations ?? {}).flatMap(
    (evaluationList) => {
      return evaluationList.map((evaluation) => {
        return elasticSearchTraceCheckToUserInterfaceEvaluation(evaluation);
      });
    }
  );

  return res.status(200).json({ ...traceDetails, spans, evaluations: evaluations_ });
}
