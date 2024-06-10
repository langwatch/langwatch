import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { getDebugger } from "../../../utils/logger";
import { nanoid } from "nanoid";

export const debug = getDebugger("langwatch:analytics");

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
      debug(e);
      return res
        .status(500)
        .json({ status: "error", message: "ID not found." });
    }
  }

  if (req.method == "PATCH") {
    try {
      const comment = req.body.comment as string;
      const isThumbsUp = req.body.isThumbsUp === "true";
      const trace = req.query.trace as string;
      const userEmail = req.body.userEmail as string;

      const user = await prisma.user.findUnique({
        where: { email: userEmail },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const addAnnotation = await prisma.annotation.create({
        data: {
          id: nanoid(),
          comment: comment,
          projectId: project.id,
          isThumbsUp: isThumbsUp,
          traceId: trace,
          userId: user.id,
        },
      });

      return res.status(200).json({ data: addAnnotation });
    } catch (e) {
      debug(e);
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error." });
    }
  }

  return res.status(405).end(); // Patch and Delete
}
