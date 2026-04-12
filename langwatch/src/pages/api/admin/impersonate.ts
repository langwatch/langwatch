import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { auth as betterAuth } from "~/server/better-auth";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { isAdmin } from "../../../../ee/admin/isAdmin";
import { auditLog } from "~/server/auditLog";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerAuthSession({ req, res });
  const user = session?.user.impersonator ?? session?.user;

  if (!session || !user || !isAdmin(user)) {
    return res.status(404).json({ message: "Not Found" });
  }

  // Fetch the raw BetterAuth session so we know which Session row to update.
  const rawHeaders = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) for (const x of v) rawHeaders.append(k, x);
    else rawHeaders.set(k, String(v));
  }
  const rawBetterAuth = await betterAuth.api.getSession({ headers: rawHeaders });
  if (!rawBetterAuth) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const sessionId = rawBetterAuth.session.id;

  if (req.method === "POST") {
    const { userIdToImpersonate, reason } = req.body;
    if (!userIdToImpersonate || !reason) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const userToImpersonate = await prisma.user.findUnique({
      where: { id: userIdToImpersonate },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        deactivatedAt: true,
      },
    });

    if (!userToImpersonate) {
      return res.status(404).json({ message: "User to impersonate not found" });
    }

    if (userToImpersonate.deactivatedAt) {
      return res
        .status(400)
        .json({ message: "Cannot impersonate a deactivated user" });
    }

    if (isAdmin(userToImpersonate)) {
      return res.status(403).json({ message: "Cannot impersonate another admin" });
    }

    await auditLog({
      userId: user.id,
      action: "admin/impersonate",
      args: {
        userIdToImpersonate: userToImpersonate.id,
        reason,
      },
      req,
    });

    // Only store identity fields in the JSON — not `deactivatedAt`.
    // The compat layer in src/server/auth.ts re-fetches the target user
    // on each request anyway to enforce the current active state.
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        impersonating: {
          id: userToImpersonate.id,
          name: userToImpersonate.name,
          email: userToImpersonate.email,
          image: userToImpersonate.image,
          expires: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
        },
      },
    });

    return res.status(200).json({ message: "Impersonation started" });
  } else if (req.method === "DELETE") {
    // In Prisma, `undefined` on a JSON field means "skip this field";
    // `Prisma.JsonNull` stores a literal JSON `null` inside the column;
    // `Prisma.DbNull` sets the column to SQL NULL. We want SQL NULL so
    // the compat layer's `impersonating && typeof ... === "object"` check
    // short-circuits cleanly and the column is queryable via `IS NULL`.
    await prisma.session.update({
      where: { id: sessionId },
      data: { impersonating: Prisma.DbNull },
    });

    return res.status(200).json({ message: "Impersonation ended" });
  } else {
    res.setHeader("Allow", ["POST", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
