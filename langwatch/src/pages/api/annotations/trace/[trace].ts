import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../../server/db";

import { createLogger } from "../../../../utils/logger.server";
import { nanoid } from "nanoid";

const logger = createLogger("langwatch:annotations:trace");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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

  if (req.method == "GET") {
    try {
      const trace = req.query.trace as string;

      const annotationsByTrace = await prisma.annotation.findMany({
        where: { traceId: trace, projectId: project.id },
      });

      if (!annotationsByTrace || annotationsByTrace.length === 0) {
        return res
          .status(404)
          .json({ status: "error", message: "No annotations found." });
      }

      return res.status(200).json({ data: annotationsByTrace });
    } catch (e) {
      logger.error({ error: e, trace: req.query.trace, projectId: project.id }, 'error fetching annotations for trace');
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error." });
    }
  }

  if (req.method == "POST") {
    try {
      const comment = req.body.comment as string;
      const isThumbsUp = req.body.isThumbsUp;
      const trace = req.query.trace as string;
      const email = req.body.email as string;

      if (!comment || typeof comment !== "string") {
        return res.status(400).json({
          status: "error",
          message:
            "[comment] is required in the request body and must be a string.",
        });
      }
      if (isThumbsUp === undefined || typeof isThumbsUp !== "boolean") {
        return res.status(400).json({
          status: "error",
          message:
            "[isThumbsUp] is required in the request body and must be a boolean.",
        });
      }
      if (!trace || typeof trace !== "string") {
        return res.status(400).json({
          status: "error",
          message: "Trace ID is required and must be a string.",
        });
      }

      const addAnnotation = await prisma.annotation.create({
        data: {
          id: nanoid(),
          comment: comment,
          projectId: project.id,
          isThumbsUp: isThumbsUp,
          traceId: trace,
          email: email,
        },
      });

      return res.status(200).json({ data: addAnnotation });
    } catch (e) {
      logger.error({ error: e, trace: req.query.trace, projectId: project.id }, 'error creating annotation');
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error." });
    }
  }

  return res.status(405).end(); // Only accept GET and POST requests
}
