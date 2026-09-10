/**
 * Reads the stored Twilio credential for one provider row.
 *
 * The phone transport dials from a headless voice run in the pool child, which
 * has no session to authorize with, so `ModelProviderService` (which takes an
 * authz context) does not fit. This is the service layer for that path: it
 * keeps the Prisma query and the decryption out of the runner. Mirrors
 * {@link findElevenLabsProviderForProject}/{@link getElevenLabsApiCredential}.
 *
 * Nothing here throws. A provider that cannot serve is `null`, and the caller
 * (the prefetcher) turns a null credential into the runner's named
 * missing-key failure — "add Twilio in Settings > Model Providers".
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
async function twilioKeys(
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
 *
 * A run resolves its credential in two steps: this finds the row that dials
 * the project's phone targets, and {@link getTwilioCredential} reads the keys
 * off it. The lookup uses the same scope chain (org, team, project) every
 * other provider read does.
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
 * The account SID, auth token and from-number to dial a phone target with, or
 * null when the row is not a Twilio row or any of the three is missing. All
 * three are required to place a call, so a half-configured row resolves to null
 * rather than reaching Twilio with an empty field.
 */
export async function getTwilioCredential({
	modelProviderId,
}: {
	modelProviderId: string;
}): Promise<TwilioCredential | null> {
	const keys = await twilioKeys(modelProviderId);
	if (!keys) return null;
	const accountSid = keys.TWILIO_ACCOUNT_SID;
	const authToken = keys.TWILIO_AUTH_TOKEN;
	const fromNumber = keys.TWILIO_FROM_NUMBER;
	if (typeof accountSid !== "string" || accountSid.length === 0) return null;
	if (typeof authToken !== "string" || authToken.length === 0) return null;
	if (typeof fromNumber !== "string" || fromNumber.length === 0) return null;
	return { accountSid, authToken, fromNumber };
}
