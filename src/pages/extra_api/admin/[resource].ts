import { defaultHandler } from "ra-data-simple-prisma";
import { prisma } from "../../../../langwatch/langwatch/src/server/db";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "../../../../langwatch/langwatch/src/server/auth";
import { isAdmin } from "../../../utils/auth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerAuthSession({ req, res });
  if (!session || (session && !isAdmin(session.user))) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (req.body.resource === "organizations") {
    req.body.resource = "organization";
  }
  const result = await defaultHandler(req.body, prisma as any);
  res.json(result);
}
