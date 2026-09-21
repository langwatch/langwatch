/**
 * What this install's license says it may call (ADR-139, section 2).
 *
 * Every hosted-service path asks here before it builds a client. The answer
 * comes from the signed license, so an install that holds an offline license,
 * or no license at all, resolves an empty entitlement and never opens a
 * connection. `LANGWATCH_CONNECT_DISABLED` overrides the license downwards and
 * never upwards.
 *
 * The entitlement signed into the license is what the install may attempt. The
 * registry row the host reads is what actually succeeds, so a service revoked
 * mid-term stops working without waiting for the license to expire.
 */

import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { PUBLIC_KEY } from "../../constants";
import { validateLicense } from "../../validation";
import { CONNECT_SERVICES, type ConnectService } from "../services";
import { readConnectConfig } from "./connectConfig";

/**
 * The key a license is checked against when a caller names none.
 *
 * Read per call rather than at module load, so a process that boots before its
 * environment is resolved does not verify every license of its life against a
 * placeholder (ADR-093).
 */
function defaultPublicKey(): string {
  return process.env.LANGWATCH_LICENSE_PUBLIC_KEY ?? PUBLIC_KEY;
}

/** The hosted services a license key names, empty where it names none. */
export function licenseConnectServices({
  licenseKey,
  publicKey,
  now,
}: {
  licenseKey: string | null | undefined;
  publicKey?: string;
  now?: Date;
}): ConnectService[] {
  if (!licenseKey) return [];
  if (!readConnectConfig().permitted) return [];

  const result = validateLicense({
    licenseKey,
    publicKey: publicKey ?? defaultPublicKey(),
    ...(now ? { now } : {}),
  });
  if (!result.valid) return [];

  const named = result.licenseData.connectServices ?? [];
  // An unknown name is dropped rather than carried, so a license minted by a
  // newer release cannot talk this one into calling a route it has no code for.
  return CONNECT_SERVICES.filter((service) => named.includes(service));
}

/**
 * The services one organization's license names.
 *
 * Falls back to the instance-wide license the same way credential resolution
 * does, so a deployment licensed through `LANGWATCH_LICENSE_KEY` is entitled
 * on every organization it carries.
 */
export async function organizationConnectServices({
  prisma,
  organizationId,
  publicKey,
  now,
}: {
  prisma: PrismaClient;
  organizationId: string;
  publicKey?: string;
  now?: Date;
}): Promise<ConnectService[]> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { license: true },
  });
  const licenseKey = organization?.license ?? env.LANGWATCH_LICENSE_KEY ?? null;
  return licenseConnectServices({
    licenseKey,
    ...(publicKey ? { publicKey } : {}),
    ...(now ? { now } : {}),
  });
}

/**
 * The services one organization actually calls: the ones its license names,
 * less the ones an administrator switched off.
 *
 * Switched on is the default for an entitled service. The column records
 * refusals rather than approvals, so a customer who bought hosted judging has
 * it working before anyone opens Settings, and a service switched off stays
 * off when the license is reissued.
 */
export async function organizationEnabledConnectServices({
  prisma,
  organizationId,
  publicKey,
  now,
}: {
  prisma: PrismaClient;
  organizationId: string;
  publicKey?: string;
  now?: Date;
}): Promise<ConnectService[]> {
  // One read for both halves of the answer. A run of judgements asks this per
  // text, so a second query here is a second query per judged row.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { license: true, connectServicesDisabled: true },
  });
  const entitled = licenseConnectServices({
    licenseKey: organization?.license ?? env.LANGWATCH_LICENSE_KEY ?? null,
    ...(publicKey ? { publicKey } : {}),
    ...(now ? { now } : {}),
  });
  const disabled = new Set(organization?.connectServicesDisabled ?? []);
  return entitled.filter((service) => !disabled.has(service));
}

/** Whether one hosted service is both entitled and switched on. */
export async function connectServiceEnabled({
  prisma,
  organizationId,
  service,
  publicKey,
  now,
}: {
  prisma: PrismaClient;
  organizationId: string;
  service: ConnectService;
  publicKey?: string;
  now?: Date;
}): Promise<boolean> {
  const enabled = await organizationEnabledConnectServices({
    prisma,
    organizationId,
    ...(publicKey ? { publicKey } : {}),
    ...(now ? { now } : {}),
  });
  return enabled.includes(service);
}

/**
 * Whether any organization on this install holds a license naming a hosted
 * service. What the workers ask before they start a loop that would call out.
 */
export async function installIsEntitled({
  prisma,
  publicKey,
  now,
}: {
  prisma: PrismaClient;
  publicKey?: string;
  now?: Date;
}): Promise<boolean> {
  if (!readConnectConfig().permitted) return false;

  const instanceWide = licenseConnectServices({
    licenseKey: env.LANGWATCH_LICENSE_KEY ?? null,
    ...(publicKey ? { publicKey } : {}),
    ...(now ? { now } : {}),
  });
  if (instanceWide.length > 0) return true;

  const organizations = await prisma.organization.findMany({
    where: { license: { not: null } },
    select: { license: true },
  });
  return organizations.some(
    (organization) =>
      licenseConnectServices({
        licenseKey: organization.license,
        ...(publicKey ? { publicKey } : {}),
        ...(now ? { now } : {}),
      }).length > 0,
  );
}
