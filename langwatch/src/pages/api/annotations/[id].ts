import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { createLogger } from "../../../utils/logger.server";

const logger = createLogger("langwatch:annotations:id");

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

  if (req.method == "DELETE") {
    try {
      const annotationId = req.query.id as string;

      await prisma.annotation.delete({
        where: { id: annotationId, projectId: project.id },
      });

      return res
        .status(200)
        .json({ status: "success", message: "Annotation deleted." });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, 'error deleting annotation');
      return res
        .status(500)
        .json({ status: "error", message: "ID not found." });
    }
  }

  if (req.method == "PATCH") {
    try {
      const comment = req.body.comment as string;
      const isThumbsUp = req.body.isThumbsUp;
      const annotationId = req.query.id as string;
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

      const patchAnnotation = await prisma.annotation.update({
        where: { id: annotationId, projectId: project.id },
        data: {
          comment: comment,
          isThumbsUp: isThumbsUp,
          email: email,
        },
      });

      return res.status(200).json({ data: patchAnnotation });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, 'error patching annotation');
      return res.status(500).json({ status: "error", message: "Not found" });
    }
  }

  if (req.method == "GET") {
    try {
      const annotationId = req.query.id as string;
      const annotation = await prisma.annotation.findUnique({
        where: { id: annotationId, projectId: project.id },
      });
      if (!annotation) {
        return res
          .status(404)
          .json({ status: "error", message: "Annotation not found." });
      }
      return res.status(200).json({ data: annotation });
    } catch (e) {
      logger.error({ error: e, projectId: project.id }, 'error fetching annotation');
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error." });
    }
  }

  return res.status(405).end(); // Patch and Delete and Get
}
