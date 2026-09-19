/**
 * The credential one organization presents to LangWatch-hosted services
 * (ADR-139).
 *
 * There is no new secret to distribute: the token is derived from the license
 * the organization already holds, or from the instance-wide license where the
 * organization has none of its own. An organization with neither cannot use
 * Connect, which is the same rule that governs every other licensed surface.
 *
 * The instance id defaults to the organization id. It survives restarts,
 * backups and hostname changes, and a second install restored from another
 * database presents a different one, which is what the host refuses as
 * `connect_wrong_instance`.
 */

import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { licenseTokenFromKey } from "../../licenseToken";
import { readConnectConfig } from "./connectConfig";
import type { ConnectCredential } from "./connectTransport";

export async function resolveConnectCredential({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<ConnectCredential | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { license: true },
  });
  if (!organization) return null;

  const licenseKey = organization.license ?? env.LANGWATCH_LICENSE_KEY ?? null;
  if (!licenseKey) return null;

  const token = licenseTokenFromKey(licenseKey);
  if (!token) return null;

  const config = readConnectConfig();
  const override = config.enabled ? config.instanceIdOverride : undefined;
  return { token, instanceId: override ?? organizationId };
}
