import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { env } from "~/env.mjs";
import { isAdmin } from "../../../../ee/admin/isAdmin";
import { getApp } from "~/server/app-layer/app";

async function hasOpsAccess(userId: string, userEmail: string | null | undefined): Promise<boolean> {
  if (isAdmin({ email: userEmail })) return true;

  if (env.IS_SAAS && env.OPS_ORG_ID) {
    const membership = await prisma.organizationUser.findFirst({
      where: { userId, organizationId: env.OPS_ORG_ID },
    });
    if (membership) return true;
  }

  const memberships = await prisma.organizationUser.findMany({
    where: { userId },
    select: { organizationId: true },
  });

  for (const membership of memberships) {
    const bindings = await prisma.roleBinding.findMany({
      where: {
        organizationId: membership.organizationId,
        userId,
      },
      select: { customRoleId: true },
    });

    for (const binding of bindings) {
      if (!binding.customRoleId) continue;
      const customRole = await prisma.customRole.findUnique({
        where: { id: binding.customRoleId },
      });
      if (!customRole) continue;
      const perms = Array.isArray(customRole.permissions)
        ? (customRole.permissions as string[])
        : [];
      if (perms.includes("ops:view") || perms.includes("ops:manage")) {
        return true;
      }
    }
  }

  return false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }

  const session = await getServerAuthSession({ req, res });
  if (!session?.user) {
    res.status(401).end();
    return;
  }

  const permitted = await hasOpsAccess(session.user.id, session.user.email);
  if (!permitted) {
    res.status(403).end();
    return;
  }

  const collector = getApp().ops?.metricsCollector;
  if (!collector) {
    res.status(503).json({ error: "Ops metrics not available" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`:ok\n\n`);

  collector.addClient(res);

  try {
    const data = collector.getDashboardData();
    res.write(`event: dashboard\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // initial data not yet available
  }

  req.on("close", () => {
    collector.removeClient(res);
  });
}
