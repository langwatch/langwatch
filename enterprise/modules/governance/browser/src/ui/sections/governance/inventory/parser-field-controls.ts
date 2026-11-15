// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal } from "@langwatch/time";

export interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  required?: boolean;
  /**
   * True when this field's value is a secret: something that must be
   * masked as the admin types it AND kept out of the plaintext
   * `parserConfig` JSONB (it belongs only inside the encrypted
   * `credentials` subtree). This is the single declaration both of those
   * decisions are driven from - see `isSecretFieldKey` in
   * `parser-fields.ts` for why that matters.
   */
  secret?: boolean;
  /**
   * What a secret field says on the edit form, where it opens blank. Absent
   * means the one-key hint: blank keeps it, a value replaces it. A secret that
   * is only replaced together with others says so here instead.
   */
  editHint?: string;
  /**
   * True for fields most admins never need: rendered inside a collapsed
   * "Advanced" group so the form leads with the required path. Leaving
   * every advanced field untouched must always produce a working source.
   */
  advanced?: boolean;
  /**
   * The sub-heading this field renders under, for a source whose fields
   * serve more than one purpose. Consecutive fields sharing a group get one
   * heading; a field without one renders as before. Purely presentational —
   * grouping never changes what is saved, only the order it is asked in.
   */
  group?: string;
  /**
   * Whether the field is shown at all, given the sibling values. Absent means
   * always. A hidden field's HELD value is deliberately not cleared (see
   * `reconcileParserValues` — clearing a switch's siblings would discard what
   * the admin typed on a mis-flip), so a builder reading a conditionally
   * hidden field must decide from the controlling field, never from whether
   * the hidden one still holds something.
   */
  visibleWhen?: (values: Record<string, string>) => boolean;
  /**
   * True for a setting the form carries but never asks about.
   *
   * Different from `visibleWhen`, which hides a field for some sibling states
   * and shows it for others. This one is never shown to anybody, and exists
   * for a setting that has stopped being a question without ceasing to be a
   * value — the Anthropic bucket width, withdrawn from new sources while the
   * sources already reading at a finer one keep doing so.
   *
   * Declared rather than deleted because the edit path only carries what is
   * declared: `seedComposerParserConfig` walks these fields to read a stored
   * config into the form, and `buildEditedParserConfig` deletes every declared
   * key before re-spreading what the builder produced. An undeclared field is
   * therefore not "left alone" — it is dropped from the stored config on the
   * next save of any other field. Its builder has to decide what to do with
   * the held value, since nothing on the form will.
   */
  hidden?: boolean;
  /**
   * How the field is rendered. Absent means a text input.
   *
   * A field only earns a `select` when its domain is closed and small enough
   * that showing it beats describing it — the point is to move the domain out
   * of the hint and into the control, so a wrong value is unreachable rather
   * than merely rejected. `date` is for values the admin thinks of as a day.
   * `switch` is for a setting with exactly two states and a right answer for
   * almost everyone: a two-entry select asks the admin to read both lines to
   * find out it was already decided for them.
   */
  control?: "select" | "date" | "switch";
  /**
   * Where a `control: "switch"` sits before anyone touches it.
   *
   * Declared on the field rather than assumed, because the form holds strings
   * and an untouched field holds nothing at all — so "no value" has to name a
   * state somewhere, and this is the one declaration the render and the
   * builder both read. They cannot drift into showing one answer and saving
   * another.
   */
  defaultOn?: boolean;
  /**
   * The two values a `control: "switch"` writes, on and off. Default
   * `"true"`/`"false"`.
   *
   * Declarable because a toggle is a way of ASKING a question, not a change to
   * what the answer is stored as. The Anthropic report has two states and one
   * right answer for almost everyone, which is a toggle — but the adapter's
   * schema reads `"cost"` and `"usage"`, and every source already saved holds
   * one of those two words. A switch hard-wired to the boolean strings would
   * open every existing usage source in the on position, because `"usage"` is
   * neither `"true"` nor `"false"` and the field would fall back to its
   * default — and the next unrelated edit would save that source as cost.
   *
   * Read by `switchFieldIsOn` and by `ParserSwitchInput`, which is the whole
   * of it: nothing downstream of the form learns that this field is a toggle.
   */
  onValue?: string;
  offValue?: string;
  /**
   * What a locked `control: "switch"` reads instead of "On" and "Off".
   *
   * Only for a switch whose two states have names of their own. A locked field
   * is rendered precisely so the admin can read what it holds, and "Off" is
   * the position of a control they can no longer see — for the Anthropic
   * report, the question they actually have is which report this source
   * records. Absent leaves the plain On/Off every other switch wants.
   */
  onLabel?: string;
  offLabel?: string;
  /**
   * What a field holds on a form nobody has touched yet.
   *
   * Only for a choice that has a right answer for almost everyone. A required
   * picker with no default asks the admin to read every option to discover
   * which one they were always going to pick, and a picker whose default is
   * only written into `startComposer` would show one answer on create and
   * another on edit. Declared on the field, so the seed and the option list
   * cannot drift.
   *
   * A function for a default that cannot be written down ahead of time — a
   * date relative to today. Called once, when a NEW composer is seeded, so
   * the value the admin sees and the value the builder is handed are the same
   * string rather than two evaluations either side of midnight. Never called
   * on the edit path: `seedComposerParserConfig` reads the stored config and
   * nothing else, because re-proposing a start here would move a date this
   * source has already read from, on a drawer opened to change a name.
   */
  defaultValue?: string | (() => string);
  /**
   * The choices, for `control: "select"`.
   *
   * Takes the sibling field values because a domain can depend on them: the
   * Anthropic cost report accepts no bucket width at all, and offering one
   * there would offer a value the builder refuses.
   */
  options?: (values: Record<string, string>) => readonly FieldOption[];
  /**
   * A hint that replaces `hint` for some sibling-field states. Same reason as
   * `options` — "cost is always daily" is only true on a cost source.
   */
  contextHint?: (values: Record<string, string>) => string | undefined;
}

/** One entry in a `control: "select"` field's list. */
export interface FieldOption {
  value: string;
  label: string;
}

/**
 * What to render for a field, once its sibling values are known.
 *
 * Kept separate from `parserFieldPresentation`, which answers the create-vs-edit
 * question and needs no sibling context. This one answers "what control, with
 * what choices", and is the only place a select's option list comes from — the
 * render, the staleness check in `reconcileParserValues` and the tests all read
 * the same list, so a domain cannot drift between what is offered and what is
 * accepted.
 */
export type FieldControl =
  | { kind: "text"; hint?: string }
  | { kind: "date"; hint?: string }
  | { kind: "select"; options: readonly FieldOption[]; hint?: string }
  | {
      kind: "switch";
      defaultOn: boolean;
      /** The two values this switch writes — see `FieldDef.onValue`. */
      onValue: string;
      offValue: string;
      /** What it reads when locked — see `FieldDef.onLabel`. */
      onLabel: string;
      offLabel: string;
      hint?: string;
    };

export function fieldControl({
  field,
  values,
}: {
  field: FieldDef;
  values: Record<string, string>;
}): FieldControl {
  const hint = field.contextHint?.(values);
  if (field.control === "date") return { kind: "date", hint };
  if (field.control === "switch") {
    return {
      kind: "switch",
      defaultOn: field.defaultOn ?? false,
      onValue: field.onValue ?? "true",
      offValue: field.offValue ?? "false",
      onLabel: field.onLabel ?? "On",
      offLabel: field.offLabel ?? "Off",
      hint,
    };
  }
  if (field.control === "select") {
    return { kind: "select", options: field.options?.(values) ?? [], hint };
  }
  return { kind: "text", hint };
}

/**
 * Whether a switch field is on, given what the form holds for it.
 *
 * A switch writes one of exactly two values and nothing else, so anything else
 * is a value no control produced — an unset field, a source created before the
 * field existed, a hand-edited config — and says nothing about what the admin
 * chose. The field's own declared default is the answer for all of them, which
 * is what keeps an untouched form and the config it saves agreeing.
 *
 * The two values default to "true"/"false" and are overridable because a
 * toggle is a way of asking, not a change to what is stored: the Anthropic
 * report is a switch over "cost" and "usage". Pass the field's own pair, or a
 * source saved on the usage report opens in the ON position — `"usage"` is
 * neither boolean string, so it would read as unset and take the default.
 *
 * Read by the render and by the builders, deliberately: a second answer to
 * "is this on" is how a toggle ends up showing one state and saving the other.
 */
export function switchFieldIsOn({
  value,
  defaultOn,
  onValue = "true",
  offValue = "false",
}: {
  value: string | undefined;
  defaultOn: boolean;
  onValue?: string;
  offValue?: string;
}): boolean {
  if (value === onValue) return true;
  if (value === offValue) return false;
  return defaultOn;
}

/**
 * What a locked switch reads, in the words of the setting rather than of the
 * control.
 *
 * A locked field is rendered read-only precisely so the admin can read what it
 * holds, and for a switch whose two states have names — the Anthropic report —
 * "Off" answers a question nobody asked. The admin's question is which report
 * this source records.
 *
 * Pure, and separate from the render, so what a locked switch says can be held
 * against the values it says it about without mounting a drawer.
 */
export function switchReadOnlyLabel({
  control,
  value,
}: {
  control: Extract<FieldControl, { kind: "switch" }>;
  value: string | undefined;
}): string {
  const on = switchFieldIsOn({
    value,
    defaultOn: control.defaultOn,
    onValue: control.onValue,
    offValue: control.offValue,
  });
  return on ? control.onLabel : control.offLabel;
}

/**
 * The `YYYY-MM-DD` an `<input type="date">` can display for a stored value.
 *
 * Every backfill start that reaches storage has been through
 * `normalizeStartingAt`, which returns an ISO instant — so the edit form always
 * seeds an instant, never a bare date, and a date input handed one renders
 * blank. Blank reads as "no backfill start configured", and saving from there
 * would drop a setting the admin never touched.
 *
 * Truncating to the UTC calendar date is display-only: the held value is left
 * alone until the admin picks a different day, so an instant that carries a
 * time of day survives an edit to any other field.
 */
export function dateInputValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  try {
    return Temporal.Instant.from(trimmed).toString().slice(0, 10);
  } catch {
    return "";
  }
}

/**
 * Which form the parser-config fields are being rendered on. The only field
 * that behaves differently is a secret: mandatory and typed in front of you on
 * create, never shown and optional on edit, where blank means "keep the stored
 * one". Everything else — validation, masking, storage routing — is shared.
 */
export type ParserConfigMode = "create" | "edit";

/**
 * The bucket widths Anthropic's usage report accepts, newest-grained first.
 *
 * Nothing offers a choice between them any more — every screen that reads this
 * data reads it by day, so a finer width multiplies the rows a day costs and
 * changes no figure the pillar shows. The list survives the withdrawal because
 * `bucketWidthToStore` still measures a stored width against it, to decide
 * whether a usage source keeps what it holds or is written down as daily: the
 * finer widths are withdrawn from new sources, not taken away from the sources
 * already being read at one.
 *
 * The adapter's own `anthropicAdminPullConfigSchema` declares the same domain
 * server-side and `anthropicFormControls.unit.test.ts` asserts the two still
 * agree, which is what keeps this a projection of the schema rather than a
 * second source of truth.
 */
export const ANTHROPIC_BUCKET_WIDTHS = ["1m", "1h", "1d"] as const;
