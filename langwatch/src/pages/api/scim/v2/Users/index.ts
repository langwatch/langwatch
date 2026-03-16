import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { UserService } from "~/server/users/user.service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const organizationId = req.headers["x-organization-id"] as string;
  if (!organizationId) {
    return res.status(400).json({ error: "Missing x-organization-id header" });
  }

  const userService = UserService.create(prisma);

  if (req.method === "GET") {
    const users = await prisma.user.findMany({
      where: { orgMemberships: { some: { organizationId } } },
      orderBy: { createdAt: "asc" },
    });
    return res.status(200).json({ users });
  }

  if (req.method === "POST") {
    const { email, name, active } = req.body as { email: string; name?: string; active?: boolean };

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const existing = await userService.findByEmail({ email });
    if (existing) {
      return res.status(409).json({ error: "User already exists" });
    }

    let user = await userService.create({ email, name: name ?? "" });

    await prisma.organizationUser.create({
      data: { userId: user.id, organizationId, role: "MEMBER" },
    });

    if (active === false) {
      user = await userService.deactivate({ id: user.id });
    }

    return res.status(201).json(user);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
