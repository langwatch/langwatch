/**
 * The identity this install presents to LangWatch (ADR-141, section 2).
 *
 * One UUID, minted the first time anything asks for it and kept in this
 * install's own database. It carries nothing about the customer, names one
 * install rather than one organization, and is the key a license row, a usage
 * report and a hosted call all join on.
 *
 * What it replaced was `${organization.name}__${organization.id}`, which put
 * the customer's name in cleartext on every report, gave an install with three
 * organizations three identities with nothing in common, and could not be
 * matched to a license without splitting a string.
 *
 * `LANGWATCH_CONNECT_INSTANCE_ID` overrides it, for an operator who has a
 * reason to name the identity: a blue-green pair that has to present one
 * identity, or a restore that has to keep the old one.
 */

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "~/generated/prisma/client";
import { readConnectConfig } from "./connectConfig";

/** The one row, so the table can hold exactly one. */
const ROW_ID = "self";

/**
 * Held for the life of the process. The id never changes once minted, and the
 * seat guard asks for it on a path that already reads three rows.
 */
let minted: string | undefined;

/** Forgets the held id. For suites, which mint a fresh one per case. */
export function resetInstanceIdentity(): void {
  minted = undefined;
}

/**
 * The identity this install presents, minting it on first use.
 *
 * Two processes starting at once both try to insert; one wins the primary key
 * and the other re-reads the winner's id, so the install never ends up with
 * two identities.
 */
export async function installInstanceId(prisma: PrismaClient): Promise<string> {
  const override = readConnectConfig().instanceIdOverride;
  if (override) return override;
  if (minted) return minted;

  const existing = await prisma.instanceIdentity.findUnique({
    where: { id: ROW_ID },
    select: { instanceId: true },
  });
  if (existing) {
    minted = existing.instanceId;
    return minted;
  }

  try {
    const created = await prisma.instanceIdentity.create({
      data: { id: ROW_ID, instanceId: randomUUID() },
      select: { instanceId: true },
    });
    minted = created.instanceId;
    return minted;
  } catch {
    const winner = await prisma.instanceIdentity.findUnique({
      where: { id: ROW_ID },
      select: { instanceId: true },
    });
    if (!winner) throw new Error("the instance identity could not be minted");
    minted = winner.instanceId;
    return minted;
  }
}

/**
 * The identity this install already holds, or null where it has never minted
 * one.
 *
 * What a reader asks for. A lease can only exist after a sync, and a sync only
 * happens after the identity was minted, so a path that is only checking a
 * lease has nothing to gain from minting one and no business writing to the
 * database.
 */
export async function readInstanceId(
  prisma: PrismaClient,
): Promise<string | null> {
  const override = readConnectConfig().instanceIdOverride;
  if (override) return override;
  if (minted) return minted;

  const row = await prisma.instanceIdentity.findUnique({
    where: { id: ROW_ID },
    select: { instanceId: true },
  });
  if (!row) return null;

  minted = row.instanceId;
  return minted;
}

/** The whole row, for a caller that needs more than the id. */
export interface InstanceIdentityRow {
  readonly instanceId: string;
  readonly createdAt: Date;
  readonly lastReportAt: Date | null;
  readonly lastReportError: string | null;
  readonly optionalMetricsOptOut: boolean;
  readonly hostnameOptOut: boolean;
  readonly startupNoticeAcknowledgedSchemaVersion: number;
}

/** The row as it stands, or null where this install has never minted one. */
export async function readInstanceIdentityRow(
  prisma: PrismaClient,
): Promise<InstanceIdentityRow | null> {
  return await prisma.instanceIdentity.findUnique({
    where: { id: ROW_ID },
    select: {
      instanceId: true,
      createdAt: true,
      lastReportAt: true,
      lastReportError: true,
      optionalMetricsOptOut: true,
      hostnameOptOut: true,
      startupNoticeAcknowledgedSchemaVersion: true,
    },
  });
}

/**
 * Records that an administrator read the startup notice for this schema
 * version (specs/self-hosting/checkup/startup-notice.feature).
 *
 * Mints the identity where there is none: an install whose administrator is
 * dismissing the notice about reporting is an install about to report, and
 * the dismissal needs a row to live on.
 */
export async function acknowledgeStartupNotice({
  prisma,
  schemaVersion,
}: {
  prisma: PrismaClient;
  schemaVersion: number;
}): Promise<void> {
  const instanceId = await installInstanceId(prisma);
  await prisma.instanceIdentity.upsert({
    where: { id: ROW_ID },
    create: {
      id: ROW_ID,
      instanceId,
      startupNoticeAcknowledgedSchemaVersion: schemaVersion,
    },
    update: { startupNoticeAcknowledgedSchemaVersion: schemaVersion },
  });
}

/**
 * Records what a customer switched off.
 *
 * `updateMany` rather than `update`: an install that has not minted an
 * identity yet has nothing to write to, and the switches it would be writing
 * are the defaults anyway.
 */
export async function setUsageReportSwitches({
  prisma,
  optionalMetricsOptOut,
  hostnameOptOut,
}: {
  prisma: PrismaClient;
  optionalMetricsOptOut?: boolean;
  hostnameOptOut?: boolean;
}): Promise<void> {
  await prisma.instanceIdentity.updateMany({
    where: { id: ROW_ID },
    data: {
      ...(optionalMetricsOptOut === undefined ? {} : { optionalMetricsOptOut }),
      ...(hostnameOptOut === undefined ? {} : { hostnameOptOut }),
    },
  });
}

/** When the usage report last reached LangWatch, and why the last one did not. */
export interface InstanceReportState {
  readonly lastReportAt: Date | null;
  readonly lastReportError: string | null;
}

/** What the checkup page reads to say whether reporting works. */
export async function readInstanceReportState(
  prisma: PrismaClient,
): Promise<InstanceReportState> {
  const row = await prisma.instanceIdentity.findUnique({
    where: { id: ROW_ID },
    select: { lastReportAt: true, lastReportError: true },
  });
  return {
    lastReportAt: row?.lastReportAt ?? null,
    lastReportError: row?.lastReportError ?? null,
  };
}

/**
 * Records how the last report went.
 *
 * A refused report is written down rather than logged and forgotten. The
 * sender used to treat any resolved `fetch` as a success, so an install whose
 * reports were being rejected looked healthy from both sides for as long as it
 * ran.
 */
export async function recordInstanceReport({
  prisma,
  error,
  at,
}: {
  prisma: PrismaClient;
  /** The refusal, or null where the report was accepted. */
  error: string | null;
  at: Date;
}): Promise<void> {
  await prisma.instanceIdentity.updateMany({
    where: { id: ROW_ID },
    data: error
      ? { lastReportError: error }
      : { lastReportAt: at, lastReportError: null },
  });
}
