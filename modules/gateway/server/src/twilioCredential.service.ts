/**
 * Reads the stored Twilio credential for one provider row. A headless voice
 * run has no session to authorize `ModelProviderService` with, so this
 * keeps the query and decryption out of the runner. Nothing here throws.
 */

import { prisma } from "~/server/db";
import { readCustomKeys } from "~/server/modelProviders/customKeys";
import { ModelProviderRepository } from "~/server/modelProviders/modelProvider.repository";

/** The account SID, auth token and origination number a phone run dials with. */
export interface TwilioCredential {
  /** The Twilio account the call is billed to. */
  accountSid: string;
  /** The account auth token. The one secret field of the three. */
  authToken: string;
  /** The account's own Twilio number (E.164) the call originates FROM. */
  fromNumber: string;
}

/** The decrypted custom keys of a Twilio row, or null for anything else. */
async function findTwilioKeys(
  modelProviderId: string,
): Promise<Record<string, unknown> | null> {
  const provider = await prisma.modelProvider.findUnique({
    where: { id: modelProviderId },
    select: { provider: true, customKeys: true },
  });
  if (provider?.provider !== "twilio") return null;
  return readCustomKeys(provider.customKeys).keys;
}

/**
 * The id of the enabled Twilio provider row a project can reach, or null.
 * A run resolves credentials in two steps: this finds the row,
 * {@link findTwilioCredential} reads its keys, same scope chain as any provider.
 */
export async function findTwilioProviderForProject({
  projectId,
}: {
  projectId: string;
}): Promise<{ id: string } | null> {
  const repository = new ModelProviderRepository(prisma);
  const rows = await repository.findAllAccessibleForProject(projectId);
  const row = rows.find((r) => r.provider === "twilio" && r.enabled);
  return row?.id ? { id: row.id } : null;
}

/**
 * The account SID, auth token and from-number to dial with, or null if not
 * a Twilio row or any of the three is missing. All three are required, so a
 * half-configured row resolves to null rather than an empty field to Twilio.
 */
export async function findTwilioCredential({
  modelProviderId,
}: {
  modelProviderId: string;
}): Promise<TwilioCredential | null> {
  const keys = await findTwilioKeys(modelProviderId);
  if (!keys) return null;
  const accountSid = keys.TWILIO_ACCOUNT_SID;
  const authToken = keys.TWILIO_AUTH_TOKEN;
  const fromNumber = keys.TWILIO_FROM_NUMBER;
  if (typeof accountSid !== "string" || accountSid.length === 0) return null;
  if (typeof authToken !== "string" || authToken.length === 0) return null;
  if (typeof fromNumber !== "string" || fromNumber.length === 0) return null;
  return { accountSid, authToken, fromNumber };
}
