// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { prisma } from "~/server/db";
import type { NextApiRequest } from "~/types/next-stubs";
import { getClientIp } from "~/utils/getClientIp";
import { safeTruncate } from "~/utils/truncate";

export const auditLog = async ({
  userId,
  actorUserId,
  organizationId,
  projectId,
  action,
  args,
  error,
  req,
  metadata,
  targetKind,
  targetId,
}: {
  /** WHOSE access was used — the subject. Under an impersonation this is the
   *  customer, which is what the session's `user.id` already resolves to. */
  userId: string;
  /**
   * Who really did it, when that is not `userId`.
   *
   * Omitted on an ordinary request, where the two are the same person.
   * Supplied under an impersonation, so the one durable record of the act
   * names the operator rather than filing it against the customer whose
   * access they borrowed.
   */
  actorUserId?: string | null;
  organizationId?: string;
  projectId?: string;
  action: string;
  args?: any;
  error?: Error;
  req?: NextApiRequest;
  metadata?: any;
  targetKind?: string;
  targetId?: string;
}) => {
  const userAgent = req?.headers["user-agent"];
  const ipAddress = getClientIp(req);

  await prisma.auditLog.create({
    data: {
      userId,
      // Only when it says something `userId` does not.
      actorUserId: actorUserId && actorUserId !== userId ? actorUserId : null,
      organizationId,
      projectId,
      action,
      args: args
        ? safeTruncate(JSON.parse(JSON.stringify(args)), 4 * 1024)
        : undefined,
      error: error?.toString(),
      ipAddress,
      userAgent,
      metadata,
      targetKind,
      targetId,
    },
  });
};
