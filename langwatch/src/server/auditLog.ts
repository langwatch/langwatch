import type { NextApiRequest } from "next";
import { getClientIp } from "../utils/getClientIp";
import { prisma } from "./db";

/** Truncate a JSON-serializable value to fit within a Postgres column. */
function truncateForAuditLog(value: unknown, maxBytes = 4 * 1024): unknown {
  const json = JSON.stringify(value);
  if (json.length <= maxBytes) return value;
  return JSON.parse(json.slice(0, maxBytes));
}

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
      userId,
      organizationId,
      projectId,
      action,
      args: args
        ? truncateForAuditLog(JSON.parse(JSON.stringify(args)))
        : undefined,
      error: error?.toString(),
      ipAddress,
      userAgent,
      metadata,
    },
  });
};
