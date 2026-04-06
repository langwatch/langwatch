import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { isAdmin } from "../../../../ee/admin/isAdmin";
import { auditLog } from "~/server/auditLog";
import { getNextAuthSessionToken } from "~/utils/auth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sessionToken = getNextAuthSessionToken(req);
  const session = await getServerAuthSession({ req, res });
  const user = (session?.user as any).impersonator
    ? (session?.user as any).impersonator
    : session?.user;
  if (!session || (session && !isAdmin(user))) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (req.method === "POST") {
    const { userIdToImpersonate, reason } = req.body;
    if (!userIdToImpersonate || !reason) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const userToImpersonate = await prisma.user.findUnique({
      where: { id: userIdToImpersonate },
    });

    if (!userToImpersonate) {
      return res.status(404).json({ message: "User to impersonate not found" });
    }

    auditLog({
      userId: session.user.id,
      action: "admin/impersonate",
      args: {
        userIdToImpersonate: userToImpersonate.id,
        reason,
      },
      req,
    });

    await prisma.session.update({
      where: { sessionToken, userId: session.user.id },
      data: {
        impersonating: {
          ...userToImpersonate,
          password: undefined,
          expires: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
        },
      },
    });

    return res.status(200).json({ message: "Impersonation started" });
  } else if (req.method === "DELETE") {
    await prisma.session.update({
      where: { sessionToken },
      // @ts-ignore
      data: { impersonating: null },
    });

    return res.status(200).json({ message: "Impersonation ended" });
  } else {
    res.setHeader("Allow", ["POST", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
