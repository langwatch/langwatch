import type { NextApiRequest } from "next";
import { getClientIp } from "../utils/getClientIp";
import { prisma } from "./db";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:audit-log");

/** Truncate a JSON-serializable value to fit within a Postgres column. */
function truncateForAuditLog<T>(value: T, maxBytes = 4 * 1024): T {
  const json = JSON.stringify(value);
  if (json.length <= maxBytes) return value;
  return { truncated: true, originalLength: json.length } as unknown as T;
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
  try {
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
  } catch (err) {
    logger.error({ err, action, projectId }, "failed to write audit log");
  }
};
