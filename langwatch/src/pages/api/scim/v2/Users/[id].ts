import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { UserService } from "~/server/users/user.service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const organizationId = req.headers["x-organization-id"] as string;
  if (!organizationId) {
    return res.status(400).json({ error: "Missing x-organization-id header" });
  }

  const userId = req.query.id as string;
  const userService = UserService.create(prisma);

  const user = await prisma.user.findFirst({
    where: { id: userId, orgMemberships: { some: { organizationId } } },
  });

  if (!user && req.method !== "DELETE") {
    return res.status(404).json({ error: "User not found" });
  }

  if (req.method === "GET") {
    return res.status(200).json(user);
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const { name, email, active } = req.body as { name?: string; email?: string; active?: boolean };

    let updated = await userService.updateProfile({ id: userId, name, email });

    if (active === false && !updated.deactivatedAt) {
      updated = await userService.deactivate({ id: userId });
    } else if (active === true && updated.deactivatedAt) {
      updated = await userService.reactivate({ id: userId });
    }

    return res.status(200).json(updated);
  }

  if (req.method === "DELETE") {
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    await userService.deactivate({ id: userId });
    await prisma.organizationUser.delete({
      where: { userId_organizationId: { userId, organizationId } },
    });
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
