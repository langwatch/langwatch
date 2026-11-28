// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { PARSER_FIELDS } from "./parser-field-catalog.ts";
import { fieldControl, type FieldDef, type ParserConfigMode } from "./parser-field-controls.ts";

/**
 * The parser values a freshly opened form holds: every field that declares a
 * `defaultValue`, and nothing else.
 *
 * Seeded into state rather than resolved at render time so what the picker
 * shows and what the builder is handed are the same value. A default that only
 * existed in the render would build a source with the field empty.
 */
export function defaultParserValues(sourceType: SourceType): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of PARSER_FIELDS[sourceType] ?? []) {
    // A function default is evaluated once, here, rather than at each render:
    // a date relative to today read twice either side of midnight would show
    // one day and save another.
    const seeded =
      typeof field.defaultValue === "function" ? field.defaultValue() : field.defaultValue;
    if (seeded) values[field.key] = seeded;
  }
  return values;
}

/**
 * The fields of a source type the form actually asks about: everything not
 * withdrawn outright, and everything its sibling values leave applicable.
 *
 * One predicate because three readers need the same answer — the render, the
 * required-field check, and the staleness reconcile. A field the render skips
 * but the required check still demands is a save refused over a control that
 * is not on the screen; a field the render skips but reconcile still measures
 * is a held value cleared because nothing offers it any more, which for the
 * withdrawn bucket width would silently migrate an hourly source to daily.
 */
export function visibleParserFields({
  sourceType,
  values,
}: {
  sourceType: SourceType;
  values: Record<string, string>;
}): FieldDef[] {
  return (PARSER_FIELDS[sourceType] ?? []).filter(
    (field) => !field.hidden && (field.visibleWhen?.(values) ?? true),
  );
}

/**
 * The composer values with any select field cleared whose held value is not
 * among the choices its own control offers.
 *
 * The shape this exists for: a select whose choices narrow when another field
 * is answered, leaving a previously valid pick outside the list the admin is
 * now looking at. A form showing one thing and submitting another is the bug;
 * clearing the stale pick is the only outcome that matches the screen.
 *
 * Deliberately narrow: text, date and switch fields are never touched,
 * because their domains are not enumerable and "not in the list" means nothing
 * there — for a switch it would mean silently turning a deliberate off back on.
 *
 * Narrow in one more direction, and the reason no field exercises this today:
 * only fields the form actually shows are measured. The bucket width was the
 * one case, and the form no longer asks it — a held width is now decided at
 * save time by `bucketWidthToStore` instead. Measured here anyway, an hourly
 * source would be cleared to daily on the first render after its drawer
 * opened, a migration performed by looking at a source.
 */
export function reconcileParserValues({
  sourceType,
  values,
}: {
  sourceType: SourceType;
  values: Record<string, string>;
}): Record<string, string> {
  let next = values;
  for (const field of visibleParserFields({ sourceType, values })) {
    const held = values[field.key];
    if (!held) continue;
    const control = fieldControl({ field, values });
    if (control.kind !== "select") continue;
    if (control.options.some((option) => option.value === held)) continue;
    if (next === values) next = { ...values };
    next[field.key] = "";
  }
  return next;
}

const SECRET_FIELD_KEYS = new Set(
  Object.values(PARSER_FIELDS)
    .flat()
    .filter((f) => f.secret)
    .map((f) => f.key),
);

/**
 * "Is this field a secret" used to be answered two different ways in this
 * file: an exact-match allowlist decided whether the input rendered masked,
 * and a separate `key.startsWith("credentials")` check in `parserFieldValue`
 * decided whether the value was routed into the encrypted `credentials`
 * subtree instead of the plaintext `parserConfig`. They happened to agree on
 * every field that existed at the time, but nothing forced them to keep
 * agreeing - a future field could satisfy one rule and not the other, and
 * the two ways that can go wrong are both bad: a genuinely secret value
 * rendered in plaintext on screen, or a plausibly-secret-looking value
 * persisted to Postgres unencrypted because it missed the `credentials*`
 * naming convention.
 *
 * This is now the ONE place that decision gets made. Both the input-masking
 * render and the parserConfig storage routing call this function, driven
 * first by the explicit `secret: true` declaration on the `FieldDef` (the
 * source of truth - see the doc comment on `FieldDef.secret`), with the
 * `credentials` prefix kept only as a belt-and-braces fallback so an
 * undeclared `credentials*` field still can't slip through and leak.
 */
export function isSecretFieldKey(key: string): boolean {
  return SECRET_FIELD_KEYS.has(key) || key.startsWith("credentials");
}

/** How one parser-config field renders on the form it was handed to. */
export interface ParserFieldPresentation {
  isSecret: boolean;
  isMultiline: boolean;
  isRequired: boolean;
  hint: string | undefined;
  placeholder: string;
}

/**
 * What a parser-config field looks like on the form it is being rendered on.
 *
 * Only a secret behaves differently between create and edit, and it differs in
 * three ways at once: the hint, the required marker, and the placeholder.
 * Deciding all three from one predicate is what stops them drifting apart — a
 * field reading "leave blank to keep the current key" while still carrying a
 * required marker is a form contradicting itself, and each ternary spelled out
 * separately in the JSX is one edit away from that.
 *
 * `isSecretFieldKey` is the same predicate the masking and the storage routing
 * use; this must not become a third, drifting answer to "is this a secret".
 */
export function parserFieldPresentation({
  field,
  mode,
}: {
  field: FieldDef;
  mode: ParserConfigMode;
}): ParserFieldPresentation {
  const isSecret = isSecretFieldKey(field.key);
  // On edit the stored secret is never sent to the client, so the field opens
  // blank and stays blank unless the admin is deliberately replacing the key.
  const keepsStoredSecret = isSecret && mode === "edit";
  return {
    isSecret,
    isMultiline: field.key === "parserDsl" || field.key === "eventMappingDsl",
    isRequired: !!field.required && !keepsStoredSecret,
    // Create's hint tells them where to generate a key, which read on the edit
    // form would suggest they have to — and re-typing a key they do not have
    // to hand is how a working source gets archived and recreated instead.
    hint: keepsStoredSecret
      ? (field.editHint ??
        "Leave blank to keep the current key. Enter a new one only to replace it.")
      : field.hint,
    placeholder: keepsStoredSecret ? "Unchanged" : field.placeholder,
  };
}

/**
 * The required fields this form is showing that hold nothing.
 *
 * Visibility first, in the `visibleParserFields` sense — `hidden` as well as
 * `visibleWhen`: a field the form never puts on screen is not something the
 * admin can answer, and marking one red points at a control that is not there.
 * Requiredness comes from `parserFieldPresentation`, the same answer the label
 * beside the input renders its asterisk from, so the form cannot mark a field
 * required and then refuse to complain about it — or complain about one it
 * never said was needed.
 *
 * Exported for the tests, which hold it against `PARSER_FIELDS`: a source type
 * whose builder refuses a field the form never marks required would toast a
 * sentence and highlight nothing, which is the failure this replaces.
 */
export function missingRequiredParserFieldKeys({
  sourceType,
  values,
  mode = "create",
}: {
  sourceType: SourceType;
  values: Record<string, string>;
  mode?: ParserConfigMode;
}): string[] {
  return visibleParserFields({ sourceType, values })
    .filter((field) => parserFieldPresentation({ field, mode }).isRequired)
    .filter((field) => (values[field.key] ?? "").trim() === "")
    .map((field) => field.key);
}
