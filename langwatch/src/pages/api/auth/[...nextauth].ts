import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth from "next-auth";

import { authOptions } from "~/server/auth";

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  return await NextAuth(req, res, authOptions(req));
}
