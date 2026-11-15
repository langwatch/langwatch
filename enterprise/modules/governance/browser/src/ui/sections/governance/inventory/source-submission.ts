// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceToaster } from "../../../../behavior/governance-feedback.ts";
import {
  routesConversations,
  type SourceType,
} from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  PULL_ADAPTER_FOR_SOURCE,
  PULL_SCHEDULE_DEFAULTS,
  recommendedPullSchedule,
} from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import { PARSER_FIELDS } from "./parser-field-catalog.ts";
import { isSecretFieldKey } from "./parser-fields.ts";
import { resolvePullConfig } from "./pull-config-builders.ts";
import type { ComposerState } from "./source-composer-state.ts";

/**
 * The create payload for the composer, or `null` when the form is not ready —
 * either unnamed, or carrying a pull config the adapter cannot honour (which
 * `resolvePullConfig` has already toasted about).
 */
export function buildCreateInput({
  composer,
  organizationId,
  toaster,
}: {
  composer: ComposerState;
  organizationId: string;
  toaster: GovernanceToaster;
}) {
  if (!composer.name.trim()) return null;
  const resolved = resolvePullConfig(composer, toaster);
  if (!resolved) return null;
  const pullAdapter = PULL_ADAPTER_FOR_SOURCE[composer.sourceType];
  return {
    organizationId,
    sourceType: composer.sourceType,
    name: composer.name.trim(),
    description: composer.description.trim() || null,
    parserConfig: buildParserConfig(composer),
    pullConfig: resolved.pullConfig,
    pullSchedule: pullAdapter
      ? composer.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS[pullAdapter] || null
      : null,
    // Read through `routesConversations` rather than sending whatever the
    // draft holds: a type switched mid-compose would otherwise carry a
    // destination its adapter never reads, and a dead column is how a
    // customer comes to believe routing is on.
    traceProjectId: routesConversations(composer.sourceType) ? composer.traceProjectId : null,
  };
}

/**
 * Form fields owned by a source type's ADAPTER config rather than by
 * parserConfig.
 *
 * The server merges pullConfig into parserConfig and lets parserConfig WIN on a
 * key clash, so a raw form value copied through here would silently override
 * the typed one its builder produced. For Genie that is not cosmetic:
 * `spaceIds` is a comma string in the form and an array in the adapter's
 * schema, so the string would win and the source would fail validation at pull
 * time — a broken source that looked fine when it was saved.
 */
const PULL_CONFIG_OWNED_FIELDS: Partial<Record<SourceType, readonly string[]>> = {
  // `report`/`bucketWidth` pass through unchanged, but `startingAt` is
  // normalized to an ISO instant by the builder — the raw form value
  // winning the merge would fail the adapter's `.datetime()` check at
  // pull time.
  anthropic_admin: ["report", "bucketWidth", "startingAt"],
  // Same reason as `startingAt` above: the builder normalizes it to an ISO
  // instant, and the raw form value winning the merge would fail the
  // adapter's `.datetime()` check at pull time.
  openai_admin: ["startingAt"],
  // `warehouseId` is here because the builder DROPS it when empty. Left to
  // the merge, the raw form value would persist `warehouseId: ""`, which the
  // adapter reads as a warehouse to go ask the workspace about.
  // `readPaidGenieBill` for the reason `readSeats` is owned further down:
  // the builder turns the switch's form value into a real boolean, and the
  // raw value winning the merge would hand the adapter a string.
  databricks_genie: ["workspaceUrl", "spaceIds", "warehouseId", "readPaidGenieBill"],
  // The builder normalises `environmentUrl` (trailing slashes stripped) and
  // turns `botIds` from a comma-separated string into an array. The raw form
  // values winning the merge would leave a string where the adapter's schema
  // expects a list, and an address the destination check reads differently
  // from the one the adapter calls.
  //
  // `azureSubscriptionId` is here because the builder OMITS it when empty,
  // exactly like Genie's `warehouseId`. An empty form value is already
  // dropped before parserConfig, so this is not fixing a live escape — it
  // keeps the single rule "a field a builder decides about is owned by the
  // builder" true for this field too, so the day the builder starts
  // normalising it there is no raw copy left to win the merge.
  //
  // `readSeats` is owned for a stronger reason than either: the builder
  // converts it from the form's string to a boolean, so the raw "yes"
  // winning the merge would reach the adapter as a string where its schema
  // demands a boolean — a source that saved cleanly and fails to parse on
  // every run.
  // `azureBillingIsPrepaid` is owned for the same reason as `readSeats`:
  // the builder converts the switch's string to the boolean the adapter's
  // schema demands, and it also OMITS the field when no subscription is
  // named — the raw form string winning the merge would undo both.
  // `azureBillingUsesSameApp` is owned for both of those reasons AND
  // because an untouched switch holds nothing at all: the flag is the only
  // durable record of the one-app choice, so it must come from the builder,
  // which writes the declared default explicitly.
  copilot_studio_dataverse: [
    "environmentUrl",
    "botIds",
    "azureSubscriptionId",
    "azureBillingIsPrepaid",
    "azureBillingUsesSameApp",
    "readSeats",
    "readDirectory",
  ],
};

// Skip sentinel for a parserConfig entry that must not be persisted, kept
// distinct from a legitimately-falsy value an admin typed.
const DROP_PARSER_FIELD = Symbol("drop");

// The persisted value for one parserConfig entry, or DROP_PARSER_FIELD to omit
// it. Pulling the per-key decision out of the loop keeps `buildParserConfig`
// flat instead of a five-deep branch ladder.
function parserFieldValue(key: string, value: unknown): unknown {
  if (value == null || value === "") return DROP_PARSER_FIELD;
  // Secrets travel in exactly one place: `pullConfig.credentials`, which is
  // the only subtree `encryptParserConfigCredentials` wraps before the row
  // reaches Postgres. A secret field copied to the top level of parserConfig
  // would be persisted as plaintext JSONB — so it never is. `isSecretFieldKey`
  // is the single source of truth for "is this a secret" (see its doc
  // comment) — this must not go back to an inline
  // `key.startsWith("credentials")` check here, or the storage-routing rule
  // can drift from the input-masking rule again.
  if (isSecretFieldKey(key)) return DROP_PARSER_FIELD;
  if (key === "pollEverySec") {
    const n = Number(value);
    return Number.isNaN(n) ? DROP_PARSER_FIELD : n;
  }
  return value;
}

export function buildParserConfig(c: ComposerState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const adapterOwned = new Set(PULL_CONFIG_OWNED_FIELDS[c.sourceType] ?? []);
  for (const [k, v] of Object.entries(c.parserConfig)) {
    if (adapterOwned.has(k)) continue;
    const resolved = parserFieldValue(k, v);
    if (resolved !== DROP_PARSER_FIELD) out[k] = resolved;
  }
  // Strip empty rows from the OTTL statement list - admins may leave a
  // blank trailing row from clicking "Add statement"; persisting it
  // would force the gateway parser to handle empty input as an error.
  const ottl = c.ottlStatements.filter((s) => s.trim().length > 0);
  if (ottl.length > 0) {
    out.ottlStatements = ottl;
  }
  return out;
}

/**
 * `buildParserConfig` read backwards: the stored config as the composer's flat
 * string form-state, for the edit form to open on.
 *
 * Only keys declared in `PARSER_FIELDS` are read, so nothing internal to the
 * row (`adapter`, `schedule`, the `_`-prefixed slots) leaks into a text input
 * an admin could then edit into something the adapter cannot parse.
 *
 * Secrets come back blank, always. `toDto` strips `credentials` before the row
 * reaches the client, so there is nothing to pre-fill even in principle — and
 * a blank field is what tells the builder to omit the key and leave the stored
 * secret alone. `isSecretFieldKey` is the same predicate the masking render
 * and the storage routing use; this must not become a third, drifting answer
 * to "is this a secret".
 */
export function seedComposerParserConfig({
  sourceType,
  storedParserConfig,
}: {
  sourceType: SourceType;
  storedParserConfig: Record<string, unknown>;
}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of PARSER_FIELDS[sourceType] ?? []) {
    if (isSecretFieldKey(field.key)) {
      values[field.key] = "";
      continue;
    }
    const stored = storedParserConfig[field.key];
    if (stored == null) continue;
    values[field.key] = seededFieldValue(stored);
  }
  for (const key of BUILDER_INPUTS_WITHOUT_FIELD[sourceType] ?? []) {
    const stored = storedParserConfig[key];
    if (stored != null) values[key] = seededFieldValue(stored);
  }
  return values;
}

/**
 * Builder inputs the form renders no field for. Seeded so an edit rebuilds them as stored: the
 * agent list is set through the API, and without this an edit would clear it to "every agent".
 */
const BUILDER_INPUTS_WITHOUT_FIELD: Partial<Record<SourceType, readonly string[]>> = {
  copilot_studio_dataverse: ["botIds"],
};

/** A stored value as its text field types it: a list the way the builder splits it. */
function seededFieldValue(stored: unknown): string {
  if (typeof stored === "string") return stored;
  if (Array.isArray(stored) && stored.every((item) => typeof item === "string")) {
    return stored.join(", ");
  }
  return JSON.stringify(stored);
}

/**
 * The cadence the edit form opens on: the `pullSchedule` column, which is what
 * the lifecycle actually runs, falling back to the adapter's copy inside
 * `parserConfig` only when the column has nothing to say.
 *
 * The two are duplicates that nothing keeps in sync. The composer writes both
 * from one value on create, so they agree for a source that has only ever been
 * touched through the UI — but `update` takes `pullSchedule` on its own, and
 * seeds, migrations and direct writes bypass the parser copy entirely. Seeding
 * from the parser copy therefore showed a cadence the source was not running
 * on, and because the save path writes the field back to the column, opening
 * such a row and saving any unrelated field overwrote the live schedule with
 * the stale one.
 *
 * The fallback stays because the column is nullable and older rows may carry
 * only the parser copy; a blank field reads as "no schedule set", which is a
 * different claim from "we could not find it".
 */
export function seedPullSchedule({
  pullSchedule,
  storedParserConfig,
}: {
  pullSchedule: string | null;
  storedParserConfig: Record<string, unknown>;
}): string {
  const fromColumn = (pullSchedule ?? "").trim();
  if (fromColumn) return fromColumn;
  const fromParser = storedParserConfig.schedule;
  return typeof fromParser === "string" ? fromParser.trim() : "";
}

/**
 * Pull source types whose adapter configuration the edit form can rebuild.
 *
 * The gate exists because "blank secret means keep the stored one" has to be
 * answered by each builder, and only Anthropic's answers it today. Databricks
 * accepts either a workspace token or a service-principal pair, so a blank
 * form there is ambiguous — it could mean "keep what is stored" or "switch
 * auth modes" — and guessing wrong locks an admin out of their own source.
 * The rest of the edit form (name, description, OTTL) is unaffected for every
 * type; only these get the adapter fields and the cadence control.
 *
 * See the follow-up issue noted in the PR for extending this to Databricks
 * Genie and the BYO `http_custom` shape.
 */
const EDITABLE_PULL_CONFIG_SOURCE_TYPES: readonly SourceType[] = [
  "anthropic_admin",
  // Answers the blank-secret question the same way: one credential, so a
  // blank field can only mean "keep the stored key".
  "openai_admin",
  // Three credentials, answered together: all blank keeps the stored app
  // registration, all three replace it, anything between is refused (#9275).
  "copilot_studio_dataverse",
];

/**
 * The stored-credential envelope, recognised without importing the server's
 * `isEncryptedCredentials` — that module reaches for node `crypto` and has no
 * business in a browser bundle. The prefix is the whole check the client needs:
 * it is refusing to send something back, not trying to read it.
 */
function isEncryptedCredentialValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

/**
 * The parserConfig an edit should persist: the stored row, with the fields the
 * form owns replaced by what the form now holds.
 *
 * The subtlety is deletion. A builder omits an optional key when its field was
 * cleared, so merging the rebuilt config over the stored one with a plain
 * spread would leave the old value in place — an admin clearing a bucket width
 * would watch the save succeed and the setting stay. Every key the form owns is
 * therefore dropped first, and the rebuilt config reinstates only the ones that
 * still have a value.
 *
 * Keys the form does NOT own are carried through untouched, which is what keeps
 * an edit from dropping `workspaceId`, `sharedSecretLastFour` and the rest of
 * the adapter's own bookkeeping.
 */
export function buildEditedParserConfig({
  sourceType,
  storedParserConfig,
  rebuiltPullConfig,
  ottlStatements,
}: {
  sourceType: SourceType;
  storedParserConfig: Record<string, unknown>;
  /** null for a push-mode source, whose adapter config the form cannot edit. */
  rebuiltPullConfig: Record<string, unknown> | null;
  ottlStatements: string[];
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...storedParserConfig };

  const cleanedOttl = ottlStatements.filter((s) => s.trim().length > 0);
  if (cleanedOttl.length > 0) {
    next.ottlStatements = cleanedOttl;
  } else {
    delete next.ottlStatements;
  }

  if (rebuiltPullConfig) {
    for (const field of PARSER_FIELDS[sourceType] ?? []) {
      delete next[field.key];
    }
    for (const key of PULL_CONFIG_OWNED_FIELDS[sourceType] ?? []) {
      delete next[key];
    }
    Object.assign(next, rebuiltPullConfig);
  }

  // Never hand back a stored envelope. `toDto` strips it, so this should be
  // unreachable — but the seed-and-respread path above only stays safe for as
  // long as that holds, and the server answers an envelope with a hard
  // ValidationError rather than a no-op.
  if (isEncryptedCredentialValue(next.credentials)) {
    delete next.credentials;
  }

  return next;
}

/**
 * Whether the edit form may rebuild this source type's adapter configuration.
 *
 * Both halves matter: the type has to actually pull, so there is a pull config
 * to rebuild at all, and it has to be on the allowlist, so the form knows what
 * a blank secret means for it. The predicate narrows, so a caller that passes
 * the DTO's bare `sourceType` string gets a `SourceType` inside the guard
 * without a second cast.
 */
export function isEditablePullSource(sourceType: SourceType | undefined): sourceType is SourceType {
  return (
    !!sourceType &&
    !!PULL_ADAPTER_FOR_SOURCE[sourceType] &&
    EDITABLE_PULL_CONFIG_SOURCE_TYPES.includes(sourceType)
  );
}

/** What the edit drawer sends to `ingestionSources.update`. */
export interface EditSubmission {
  organizationId: string;
  id: string;
  name: string;
  description: string | null;
  parserConfig: Record<string, unknown>;
  pullSchedule?: string | null;
  /**
   * Absent means "leave the stored destination alone".
   *
   * Three-valued on purpose, mirroring what `updateSource` does with it
   * (`ingestionSource.service.ts:529-539`): absent = the admin never touched
   * the picker, `null` = they cleared it and routing stops, an id = they
   * picked one and it is re-validated as create would.
   *
   * Echoing the stored id back on every save instead would look identical
   * until the destination project is archived — at which point the
   * write-time guard rejects it and the admin can no longer rename the
   * source, or repoint the destination, or do anything else in this drawer.
   */
  traceProjectId?: string | null;
}

/**
 * The pull config an edited pull source would run on, or null when a field is
 * one the adapter cannot parse. Reuses the create path's dispatcher, and with
 * it the toast that names which field is wrong — a second builder here is how
 * the two forms would drift into disagreeing about what a valid bucket width is.
 */
function rebuildEditedPullConfig({
  toaster,
  ...draft
}: Omit<ComposerState, "traceProjectId"> & {
  toaster: GovernanceToaster;
}): Record<string, unknown> | null {
  const resolved = resolvePullConfig(
    // The destination is not part of the adapter's pull config — it only
    // decides where routed conversations land afterwards. Null here so
    // this literal satisfies ComposerState without implying otherwise.
    { ...draft, traceProjectId: null },
    toaster,
    { shouldRequireCredentials: false },
  );
  return resolved?.pullConfig || null;
}

/**
 * The edit form's submission, assembled from the form state and the row it
 * opened on. `null` means the form is not in a saveable state and the caller
 * does nothing: either the name is empty, or a pull field is one the adapter
 * cannot parse — in which case `resolvePullConfig` has already toasted which.
 *
 * Module-level rather than a closure inside the drawer because this is where
 * the decisions that matter live — whether the pull config is rebuilt at all,
 * and whether `pullSchedule` rides along — and no test renders the drawer.
 * Leaving them inline made the whole edit path reachable only through a React
 * surface nothing exercises.
 */
export function buildEditSubmission({
  organizationId,
  source,
  name,
  description,
  parserConfig,
  ottlStatements,
  pullSchedule,
  destination,
  toaster,
}: {
  organizationId: string;
  source: { id: string; sourceType: string; parserConfig: unknown };
  name: string;
  description: string;
  parserConfig: Record<string, string>;
  ottlStatements: string[];
  pullSchedule: string;
  /** `undefined` = untouched, `null` = cleared, an id = picked. */
  destination: string | null | undefined;
  toaster: GovernanceToaster;
}): EditSubmission | null {
  const trimmedName = name.trim();
  if (!trimmedName) return null;

  const sourceType = source.sourceType as SourceType;
  const isPullMode = isEditablePullSource(sourceType);

  let rebuiltPullConfig: Record<string, unknown> | null = null;
  if (isPullMode) {
    rebuiltPullConfig = rebuildEditedPullConfig({
      sourceType,
      name: trimmedName,
      description: description.trim(),
      parserConfig,
      ottlStatements,
      pullSchedule,
      toaster,
    });
    // Refusing here names the field before a round trip; the server runs the
    // adapter's schema on save as well.
    if (!rebuiltPullConfig) return null;
  }

  return {
    organizationId,
    id: source.id,
    name: trimmedName,
    description: description.trim() || null,
    parserConfig: buildEditedParserConfig({
      sourceType,
      storedParserConfig: (source.parserConfig as Record<string, unknown>) ?? {},
      rebuiltPullConfig,
      ottlStatements,
    }),
    // Only sent for a type whose cadence the form actually renders. Including
    // it for a push source would send `null` for a column no one edited.
    //
    // Blank is the cadence field's way of saying "the recommended schedule",
    // not "never run" — so it resolves here, exactly as create resolves it.
    // Sending null would write a null column, and the lifecycle reads a null
    // schedule as `disable` (see `ingestionPullLifecycle`), so clearing the
    // field would quietly stop the source while the drawer, reading the
    // rebuilt parser config, still showed it running on the default.
    ...(isPullMode
      ? {
          pullSchedule: pullSchedule.trim() || recommendedPullSchedule(sourceType),
        }
      : {}),
    // Same guard as create: a type that routes nothing must never carry a
    // destination, even one left in drawer state from before a type change.
    // An untouched picker sends nothing at all, so renaming a source cannot
    // drag a since-archived destination back through the write-time guard.
    ...(destination === undefined || !routesConversations(sourceType)
      ? {}
      : { traceProjectId: destination }),
  };
}
