import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "../../../../langwatch/langwatch/src/server/auth";
import { prisma } from "../../../../langwatch/langwatch/src/server/db";
import { isAdmin } from "../../../utils/isAdmin";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sessionToken = req.cookies["next-auth.session-token"];
  const session = await getServerAuthSession({ req, res });
  const user = (session?.user as any).impersonator
    ? (session?.user as any).impersonator
    : session?.user;
  if (!session || (session && !isAdmin(user))) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (req.method === "POST") {
    const { userIdToImpersonate } = req.body;

    const userToImpersonate = await prisma.user.findUnique({
      where: { id: userIdToImpersonate },
    });

    if (!userToImpersonate) {
      return res.status(404).json({ message: "User to impersonate not found" });
    }

    await prisma.session.update({
      where: { sessionToken, userId: session.user.id },
      data: { impersonating: userToImpersonate },
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
