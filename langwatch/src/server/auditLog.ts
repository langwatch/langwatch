import type { NextApiRequest } from "next";
import { getClientIp } from "../utils/getClientIp";
import { prisma } from "./db";
import { safeTruncate } from "../utils/truncate";
import { permissionGuardedString } from "./api/permission";

export const auditLog = async ({
  userId,
  organizationId,
  projectId,
  action,
  args,
  error,
  req,
  metadata,
}: {
  userId: string;
  organizationId?: string;
  projectId?: string;
  action: string;
  args?: any;
  error?: Error;
  req?: NextApiRequest;
  metadata?: any;
}) => {
  const userAgent = req?.headers["user-agent"];
  const ipAddress = getClientIp(req);

  await prisma.auditLog.create({
    data: {
      userId: userId,
      organizationId: permissionGuardedString(organizationId),
      projectId: permissionGuardedString(projectId),
      action,
      args: args ? safeTruncate(args, 4 * 1024) : undefined,
      error: error?.toString(),
      ipAddress,
      userAgent,
      metadata,
    },
  });
};
