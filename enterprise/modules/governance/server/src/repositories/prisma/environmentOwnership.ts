// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Who is allowed to read a conversation environment.
 *
 * The sibling of {@link ./azureBillOwnership.ts} for the identity an admin
 * types rather than one a provider reports. A Power Platform environment holds
 * one set of conversations, and everything below the read files what it fetched
 * against the source that fetched it. So two sources naming one environment
 * store the same conversations twice under two source identities, and every
 * count derived from them — messages, people, agents — reports double. Both
 * copies are individually correct, which is what makes it hard to see.
 *
 * It lives beside the Azure guard rather than inside it because an environment
 * is not an Azure bill: one is a subscription id read off the form, the other
 * is an address that has to be normalised before two spellings of it can be
 * compared. The module is named for what it owns.
 *
 * The comparison is the reason this is a guard and not an equality check. An
 * environment address survives a trailing slash, a change of case and a path
 * after it, and a check that takes the typed text at face value refuses almost
 * nothing. `isSameDataverseEnvironment` already normalises exactly that for the
 * transcript walk, so it is imported rather than re-derived here — a second
 * copy of that rule is a copy that can quietly disagree with the first.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlement 6 (Dataverse identity = environment origin).
 */

import { ValidationError } from "@langwatch/handled-error";
import { isSameDataverseEnvironment } from "../../services/dataverse-environment.service.ts";

/** The config key naming the environment a source reads conversations from. */
export const ENVIRONMENT_URL_FIELD = "environmentUrl";

/** A source that already reads some conversation environment. */
export interface EnvironmentReader {
  id: string;
  name: string;
  environmentUrl: string;
}

/**
 * The environment a config claims, or null when it claims none.
 *
 * Blank and non-string both read as "none" rather than as an environment named
 * the empty string, which would have every source without an environment
 * collide with every other one. The composer drops an empty field before it
 * builds the config, so this is not fixing a live escape — it holds because
 * anything reaching the service directly is under no such obligation.
 */
export function readClaimedEnvironment(
  parserConfig: Record<string, unknown> | null | undefined,
): string | null {
  if (!parserConfig || typeof parserConfig !== "object") return null;
  const claimed = parserConfig[ENVIRONMENT_URL_FIELD];
  if (typeof claimed !== "string") return null;
  const trimmed = claimed.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Refuse a save that names an environment another live source already reads.
 *
 * A no-op for a config claiming no environment — silence here means "nothing
 * claimed", never "checked and fine".
 *
 * `sourceId` is the source being written, excluded from its own check so that
 * renaming a source, or any other edit that resends the environment it already
 * holds, does not make it collide with itself.
 *
 * `claimedBy` is passed in rather than read here so the whole decision is one
 * pure function. A database filter on a JSON field could not do it: the
 * comparison normalises scheme, host case, port and path, and a JSON-path
 * filter is literal, so it would silently match nothing on exactly the input
 * that needs catching.
 */
export function assertEnvironmentNotAlreadyClaimed(params: {
  parserConfig: Record<string, unknown> | null | undefined;
  claimedBy: EnvironmentReader[];
  sourceId?: string;
}): void {
  const { parserConfig, claimedBy, sourceId } = params;

  const claimed = readClaimedEnvironment(parserConfig);
  if (claimed === null) return;

  const owner = claimedBy.find(
    (reader) =>
      reader.id !== sourceId &&
      // A reader whose own address is blank must not swallow a real claim:
      // `isSameDataverseEnvironment` returns false for an unparseable address,
      // so two sources that name nothing are never in conflict.
      isSameDataverseEnvironment({
        value: claimed,
        environmentUrl: reader.environmentUrl,
      }),
  );
  if (!owner) return;

  // The complaint travels in `meta.formErrors` because that is the half of the
  // `validation_error` contract the presentation layer reads for a field it has
  // no on-screen name for. Without it the admin gets the generic "Check your
  // input" copy and never learns which connection already holds the
  // environment, which is the entire point of naming the owner here.
  const complaint = `The connection "${owner.name}" already reads conversations from this environment. Reading one environment from two connections files the same conversations twice, so every count taken from them reports double. Archive that connection, or name a different environment here.`;
  throw new ValidationError(complaint, {
    meta: { formErrors: [complaint] },
  });
}
