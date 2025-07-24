import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth from "next-auth";

import { authOptions } from "~/server/auth";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("auth");

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await NextAuth(req, res, authOptions(req));
  } catch (error) {
    logger.error({ error }, "Error in auth");
    return res.redirect(`/api/auth/error?error=Internal Server Error`);
  }
}
