// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal } from "@langwatch/time";

import type { SourceType } from "../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { defaultBackfillStart } from "../../../features/ingestion-sources/model/pull-cadence.ts";

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
   * decisions are driven from - see `isSecretFieldKey` below for why
   * that matters.
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

/**
 * Whether a Copilot Studio source reads the tenant's seat licences when nobody
 * has said either way.
 *
 * One constant because two readers need the same answer: the switch renders
 * from it, and `buildCopilotStudioDataversePullConfig` saves from it for a form
 * that was never touched. Split them and the form shows one state while the
 * save stores the other.
 */
export const READ_SEATS_DEFAULT_ON = true;

/**
 * Whether a Copilot Studio source reads the tenant's directory when nobody has
 * said either way.
 *
 * On, for the same reason the seat read is on: a source that records who ran an
 * agent and never says who they are answers "who is using this" with a list of
 * opaque ids, and an admin who wanted the answer would have had to know the
 * setting existed to get it. The directory read is what turns those ids into
 * people, departments and the agents' own owners - every screen in the pillar
 * that names a person is downstream of it.
 *
 * The consent is real and heavier than the seat read's - `/users` needs
 * `User.Read.All` - which is why the switch stays on the form rather than being
 * assumed: an admin who does not want it turns it off in the same sitting. What
 * it must not do is default off and stay unmentioned, which is how the product
 * came to show an empty People screen with no page anywhere saying why. A
 * refusal costs nothing: `readMicrosoftDirectory` holds the day rather than
 * failing the run.
 *
 * One constant, read by the switch and by the builder, so an untouched form
 * cannot show one state and save the other.
 */
export const READ_DIRECTORY_DEFAULT_ON = true;

/**
 * Whether a new Copilot Studio source uses one app registration for both the
 * conversation read and the bill, when nobody has said either way.
 *
 * On, because most admins set up one app and stop there (issue #7775). The
 * split-credential arrangement stays the recommendation for tenants whose
 * finance approval is separate (ADR-128 §21.1) — it is one switch away, not
 * the price of entry. Same one-constant rule as `READ_SEATS_DEFAULT_ON`:
 * the switch renders from it, the billing fields hide from it, and the
 * builder saves from it, so an untouched form cannot show one arrangement
 * and store another.
 */
const AZURE_ONE_APP_DEFAULT_ON = true;

/** Whether the form's held values choose one app registration for everything. */
export function azureOneAppChosen(values: Record<string, string>): boolean {
  return switchFieldIsOn({
    value: values.azureBillingUsesSameApp,
    defaultOn: AZURE_ONE_APP_DEFAULT_ON,
  });
}

/**
 * The Copilot Studio secrets' edit hints. The app registration is stored as
 * one sealed set, so it is kept or replaced whole (#9275): the generic "leave
 * blank to keep the current key" would invite replacing one value of three.
 */
const COPILOT_REGISTRATION_EDIT_HINT =
  "Leave the tenant ID, client ID and client secret all blank to keep the current app registration. To replace it, enter all three together, and enter the billing client ID and secret again if the bill has its own app registration.";

const COPILOT_BILLING_EDIT_HINT =
  "Leave blank to keep the current billing app registration. It is stored with the main app registration, so to change it, also enter the tenant ID, client ID and client secret.";

export const PARSER_FIELDS: Record<SourceType, FieldDef[]> = {
  // No parser-config fields for generic OTel sources today - the
  // receiver accepts any well-formed OTLP/HTTP body. (Earlier copy
  // referenced a `LangWatchSourceType` attribute filter that the
  // normaliser doesn't actually implement; removed during bugbash so
  // the composer doesn't promise behaviour we don't ship.)
  otel_generic: [],
  // Claude Code's per-request shape is conveyed through OTTL statements
  // (parserConfig.ottlStatements), which the OttlEditor renders as its
  // own panel. No extra parser fields needed at the per-source level.
  claude_code: [],
  claude_cowork: [
    {
      key: "workspaceId",
      label: "Anthropic workspace ID",
      placeholder: "wsp_...",
      hint: "Find under Anthropic Admin Console → Workspace → Settings.",
      required: true,
    },
  ],
  workato: [
    {
      key: "sharedSecretLastFour",
      label: "Last 4 chars of the shared HMAC secret",
      placeholder: "e.g. a3f9",
      hint: "We auto-generate the HMAC secret + only store its hash. The last-4 helps you visually confirm which secret is configured upstream.",
      required: true,
    },
  ],
  copilot_studio: [
    {
      key: "tenantId",
      label: "Azure AD tenant ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
    },
    {
      key: "clientId",
      label: "App registration client ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
    },
    {
      key: "clientSecret",
      label: "App registration client secret",
      placeholder: "(value pasted from Azure portal)",
      hint: "We hash this server-side; only the hash is persisted.",
      required: true,
      secret: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "300",
      hint: "How often to call Purview Audit. Default 300s.",
    },
  ],
  // Three groups, in the order admins care (issue #7775): where the
  // environment lives, what it costs, and who may read its conversations.
  // Grouping is presentational only — every key, secret flag and builder
  // below is unchanged by it.
  copilot_studio_dataverse: [
    {
      key: "environmentUrl",
      label: "Power Platform environment URL",
      placeholder: "https://org12345.crm.dynamics.com",
      hint: "From Power Platform admin centre → your environment → Environment URL. Environments served from a custom domain are not supported yet.",
      required: true,
      group: "Connection",
    },
    {
      // Named `credentials*` on purpose, like the Databricks fields: the
      // adapter reads all three from `pullConfig.credentials`, which is the
      // only subtree the server encrypts. A field named `tenantId` would be
      // dropped by `parserFieldValue` and never reach the adapter at all.
      key: "credentialsTenantId",
      label: "Microsoft Entra tenant ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
      secret: true,
      editHint: COPILOT_REGISTRATION_EDIT_HINT,
      group: "Connection",
    },
    {
      // NOT a `credentials*` field, unlike the tenant id above. A
      // subscription id is a coordinate rather than a secret, and the adapter
      // reads it off the config itself; naming it
      // `credentialsAzureSubscriptionId` would bury it in the encrypted
      // subtree where the config schema never looks.
      key: "azureSubscriptionId",
      label: "Azure subscription ID (optional)",
      placeholder: "00000000-0000-0000-0000-000000000000",
      hint: "Add this to also record what the environment costs each day. Leave it empty to record conversations only.",
      group: "Cost",
    },
    {
      key: "credentialsClientId",
      label: "App registration client ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
      secret: true,
      editHint: COPILOT_REGISTRATION_EDIT_HINT,
      group: "Conversation access",
    },
    {
      key: "credentialsClientSecret",
      label: "App registration client secret",
      placeholder: "(value pasted from the Azure portal)",
      hint: "The app needs a Dataverse application user in this environment with read access to the conversation transcript and bot tables. No directory permission is required.",
      required: true,
      secret: true,
      editHint: COPILOT_REGISTRATION_EDIT_HINT,
      group: "Conversation access",
    },
    {
      // One app for both reads is what most admins actually set up; the
      // split-credential arrangement (ADR-128 §21.1) stays one flip away for
      // tenants whose finance approval is separate. The choice itself is
      // persisted by the builder (`azureBillingUsesSameApp`), because it
      // cannot be reconstructed from the stored credentials once they are
      // sealed. Last on the form: it refers back to the credential above it,
      // and most admins never touch it.
      key: "azureBillingUsesSameApp",
      label: "Use one app registration for everything",
      placeholder: "",
      hint: "On, the app registration under Conversation access also reads the subscription's bill: grant it the Cost Management Reader role on the subscription. Turn it off to give the bill its own app registration, holding that role and nothing else, so the finance approval never hands out conversation access.",
      control: "switch",
      defaultOn: AZURE_ONE_APP_DEFAULT_ON,
      group: "Billing",
    },
    {
      // The bill's OWN app registration: it holds Cost Management Reader on
      // the subscription and nothing else, so the person who approves the
      // finance grant hands out a permission that reads money and cannot read
      // a conversation. Only offered once the admin has turned the one-app
      // switch off — hidden, the copy in `copilotAzureBillingFrom` answers
      // instead.
      key: "credentialsBillingClientId",
      label: "Billing app registration client ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      hint: "A second app registration, used only to read the subscription's bill. Grant it the Cost Management Reader role on the subscription: it needs no Dataverse or directory permission. If the first read fails right after granting, wait a couple of minutes: the role takes a moment to spread.",
      secret: true,
      editHint: COPILOT_BILLING_EDIT_HINT,
      group: "Billing",
      visibleWhen: (values) => !azureOneAppChosen(values),
    },
    {
      key: "credentialsBillingClientSecret",
      label: "Billing app registration client secret",
      placeholder: "(value pasted from the Azure portal)",
      secret: true,
      editHint: COPILOT_BILLING_EDIT_HINT,
      group: "Billing",
      visibleWhen: (values) => !azureOneAppChosen(values),
    },
    {
      // Declared by the customer, never inferred (ADR-128 §21.4): prepaid
      // credit packs create no Azure resource, so the cost feed returns
      // nothing — byte-for-byte what a quiet pay-as-you-go month returns.
      // Only this declaration licenses the panel's prepaid sentence.
      // Advanced because almost nobody runs on packs: the declaration is
      // where an admin goes to disagree with the pay-as-you-go default.
      key: "azureBillingIsPrepaid",
      label: "This Copilot runs on prepaid message packs",
      placeholder: "",
      hint: "Prepaid message packs never appear on the Azure bill. Turn this on and the spend panel will say so instead of showing an empty bill as if nothing ran.",
      control: "switch",
      defaultOn: false,
      advanced: true,
    },
    {
      key: "readSeats",
      label: "Also record license counts",
      placeholder: "",
      hint: "Reads once a day how many Copilot Studio licenses the tenant has bought and how many are assigned, only pool totals, never a list of users. It needs an admin consent the other fields do not: a tenant admin must grant the app registration the Organization.Read.All application permission. Without it the read is refused and nothing is recorded.",
      control: "switch",
      defaultOn: READ_SEATS_DEFAULT_ON,
      // Advanced because the default is already the answer for almost
      // everyone: the collapsed group is where an admin goes to disagree, not
      // where the setting hides.
      advanced: true,
    },
    {
      // Primary, not advanced, unlike the seat read beside it. The two switches
      // look alike and are not: turning this one off empties the People and
      // Departments screens and leaves every agent unowned, so it is a choice
      // an admin should make while looking at it rather than discover later
      // behind a collapsed group.
      key: "readDirectory",
      label: "Also record people and departments",
      placeholder: "",
      hint: "Reads once a day the directory entries of the people who ran an agent, so the pillar can show names, departments and agent owners instead of opaque ids. It needs a consent the conversation read does not: a tenant admin must grant the app registration the User.Read.All application permission, which lets this source read every user in the tenant. Turn it off and conversations are still recorded, just against ids nobody can put a name to. Without the grant the read is refused, nothing is recorded, and the run still succeeds.",
      control: "switch",
      defaultOn: READ_DIRECTORY_DEFAULT_ON,
    },
  ],
  openai_compliance: [
    {
      key: "bucket",
      label: "S3 bucket name",
      placeholder: "acme-openai-compliance",
      required: true,
    },
    {
      key: "prefix",
      label: "S3 key prefix",
      placeholder: "compliance/",
      hint: "OpenAI Enterprise Compliance writes JSONL files under this prefix.",
    },
    {
      key: "roleArn",
      label: "Cross-account role ARN",
      placeholder: "arn:aws:iam::123456789012:role/LangWatchComplianceReader",
      hint: "We assume this role to read the bucket. Trust policy must allow our account.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "60",
    },
  ],
  openai_admin: [
    {
      // `credentials*` prefix routes this into the encrypted `credentials`
      // subtree — the only part of the config the server encrypts at rest.
      key: "credentialsToken",
      label: "Admin API key",
      placeholder: "sk-admin-...",
      hint: "Generate under OpenAI Platform → Settings → Organization → Admin keys. A regular project key returns 401 on the organization reports. We encrypt this server-side.",
      required: true,
      secret: true,
    },
    {
      key: "startingAt",
      label: "Read history from",
      placeholder: "",
      hint: "The first day we read data for. Later runs continue forward from where the last one stopped. Clear it to read only the last few days. Spend broken down by API key is only available from December 2025 onward; earlier days are still read and still name the person, just not the key.",
      control: "date",
      defaultValue: () => defaultBackfillStart("openai_admin") ?? "",
    },
  ],
  claude_compliance: [
    {
      // `credentials*` prefix, like every other secret this form collects:
      // it is what routes the value into the encrypted `credentials` subtree
      // the adapter's frozen `${{credentials.token}}` header reads. Under its
      // old name the field was collected, dropped by `parserFieldValue` as a
      // secret, and put back by nothing.
      key: "credentialsToken",
      label: "Workspace API key",
      placeholder: "sk-ant-admin-...",
      hint: "Generate under Anthropic Admin Console → Compliance → Workspace API Keys. We hash this server-side.",
      required: true,
      secret: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "300",
    },
  ],
  anthropic_admin: [
    {
      // `credentials*` prefix routes this into the encrypted `credentials`
      // subtree — same rule as the Genie token below.
      key: "credentialsToken",
      label: "Admin API key",
      placeholder: "sk-ant-admin-...",
      hint: "Generate under Anthropic Admin Console → API Keys → Admin Keys. A regular workspace key returns 401 on the organization reports. We encrypt this server-side.",
      required: true,
      secret: true,
    },
    {
      key: "report",
      // Named for what the admin gets rather than for the setting. A toggle's
      // label can only name one side, so it names the side that is on.
      label: "Use Anthropic's reported cost",
      placeholder: "",
      // Everything the two-entry picker conveyed by listing both reports has
      // to live here instead, or an admin turning this off is not told what
      // they are turning it on to.
      hint: "On: Anthropic's own daily spend figure, which is what almost everyone wants (Priority Tier usage is excluded, so it is close to but not the invoice). Off: raw token counts that we price ourselves. A source records one report only, never both: pointing two sources at the same organization would count the same spend twice.",
      // Two states, and one of them right for almost every organization: the
      // provider's own figure for what was spent. The usage report is the
      // specialist choice, made by someone who wants our pricing applied to
      // raw token counts instead. A two-entry picker asked the admin to read
      // both lines to discover it had already been decided for them.
      control: "switch",
      defaultOn: true,
      // The adapter's own words, unchanged. `anthropicAdmin.puller.ts` still
      // reads "cost" and "usage", and every source already saved holds one of
      // them — this is a different way of asking the same question, not a
      // change to what any source stores.
      onValue: "cost",
      offValue: "usage",
      // What it reads once it locks. "Off" is the position of a control the
      // admin can no longer see; the question they have is which report this
      // source records.
      onLabel: "Cost report",
      offLabel: "Usage report",
      // Not required, because a toggle has no empty state to refuse: it is one
      // of two values from the moment the composer seeds it, and the seed is
      // what makes dropping the flag safe.
      defaultValue: "cost",
    },
    {
      key: "bucketWidth",
      label: "Bucket width",
      placeholder: "",
      hint: "How finely the usage report is bucketed.",
      // Never asked. Every screen that reads this data reads it by day, so the
      // finer widths multiply the rows a day costs and change no figure the
      // pillar shows — the answer was always daily and asking was the mistake.
      //
      // Declared rather than deleted, because the edit path only carries what
      // is declared: `seedComposerParserConfig` would not read a stored `1h`
      // into the form and `buildEditedParserConfig` would delete it from the
      // stored config, so an hourly source would be migrated to daily by an
      // admin opening its drawer to change its name.
      // `buildAnthropicAdminPullConfig` is what decides the held value's fate,
      // since nothing on the form will.
      hidden: true,
    },
    {
      key: "startingAt",
      label: "Read history from",
      placeholder: "",
      hint: "The first day we read data for. Later runs continue forward from where the last one stopped. Clear it to read only the last few days. On the usage report this date is fixed once the source has pulled.",
      control: "date",
      defaultValue: () => defaultBackfillStart("anthropic_admin") ?? "",
    },
  ],
  databricks_genie: [
    {
      key: "workspaceUrl",
      label: "Workspace URL",
      placeholder: "https://adb-1234567890123456.7.azuredatabricks.net",
      required: true,
    },
    {
      // Named `credentials*` on purpose. `buildParserConfig` does not route
      // these anywhere — it DROPS every secret field, so none is ever written
      // to the plaintext part of parserConfig. Putting them back under
      // `credentials`, the ONLY subtree the server encrypts before the row
      // reaches the database, is this source type's pull-config builder's
      // job. A field named `clientId` would be dropped just the same and
      // never reach the adapter at all.
      key: "credentialsClientId",
      label: "Service principal client ID",
      placeholder: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
      hint: "The source signs in with this service principal at the start of every run. It needs Can Manage on every Genie space you want covered: read access is not enough. Databricks only returns other people's conversations to an identity that can manage the space, so a weaker one records nothing and reports no error.",
      secret: true,
    },
    {
      key: "credentialsClientSecret",
      label: "Service principal secret",
      placeholder: "dose...",
      hint: "The OAuth secret for that service principal. We encrypt this server-side.",
      secret: true,
    },
    {
      key: "credentialsToken",
      label: "Workspace token",
      placeholder: "dapi...",
      hint: "A personal access token, pasted instead of the service principal client ID and secret; when both are given, the token wins. Databricks expires these about an hour after issuing them, so a source that runs on a schedule is dead by the next morning: only use a token for a one-off backfill. It needs the same Can Manage on every Genie space. We encrypt this server-side.",
      secret: true,
      advanced: true,
    },
    {
      key: "spaceIds",
      label: "Genie space IDs (optional)",
      placeholder: "Leave empty to cover every space the credential can see",
      hint: "Comma-separated. Empty is the usual setting: every space the credential can see is covered, including spaces created later.",
      advanced: true,
    },
    {
      key: "warehouseId",
      label: "SQL warehouse ID (optional)",
      advanced: true,
      placeholder: "095eb666b2ed2762",
      hint: "Any warehouse this credential can run a query on. It is where the billing lookup itself runs, NOT the warehouse being priced, which is every warehouse the questions used. Set it to attribute the compute behind each question to the person who asked; leave it empty and questions are recorded without an amount, since the compute behind them was never read. Naming one makes every run submit a query, so a stopped warehouse is started and billed on the source's schedule. The token additionally needs SELECT on the `system` catalogue, which only a metastore admin can grant: without it questions are still recorded, without cost. The figure is a share of the hourly bill at list prices, so it is an estimate, not the invoice.",
    },
    {
      key: "readPaidGenieBill",
      label: "Also record Genie's own bill line",
      placeholder: "",
      hint: "Reads the usage Databricks bills under the Genie product itself, the per-message and inference charges, separate from the warehouse compute the questions run on, and records it per person, per day, per price line, at list price. It runs on the same SQL warehouse as the question pricing and needs the same SELECT on the `system` catalogue; with no warehouse named the read cannot start and the run says so. Off by default because most workspaces are still on Genie's free line, which this read records as usage with no amount.",
      control: "switch",
      defaultOn: false,
      // Advanced for the same reason the warehouse id beside it is: it is a
      // billing read a metastore admin has to grant, not part of getting the
      // source to record conversations at all.
      advanced: true,
    },
  ],
  s3_custom: [
    {
      key: "bucket",
      label: "S3 bucket name",
      placeholder: "acme-agent-audit",
      required: true,
    },
    {
      key: "prefix",
      label: "S3 key prefix",
      placeholder: "audit-logs/",
    },
    {
      key: "roleArn",
      label: "Cross-account role ARN",
      placeholder: "arn:aws:iam::123456789012:role/LangWatchAuditReader",
      required: true,
    },
    {
      key: "parserDsl",
      label: "Parser DSL (line → OCSF ActivityEvent mapping)",
      placeholder: "actor=$.user.email\naction=$.event_type\ntimestamp=$.ts",
      hint: "One field-mapping per line. Each maps an OCSF field to a JSONPath into the source line.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "60",
    },
  ],
  http_custom: [
    {
      key: "url",
      label: "Audit-log endpoint URL",
      placeholder: "https://api.acme.com/v1/audit-log",
      hint: "Paginated REST endpoint that returns a JSON page of events plus a next-cursor.",
      required: true,
    },
    {
      key: "authHeaderName",
      label: "Auth header name",
      placeholder: "Authorization",
      hint: "Standard bearer flow: leave as Authorization. For x-api-key style auth, paste the header name.",
      required: true,
    },
    {
      key: "authHeaderValue",
      label: "Auth header value (template)",
      placeholder: "Bearer ${{credentials.token}}",
      hint: "Use ${{credentials.token}} where the secret should be substituted at request time. The token itself is captured in the next field.",
      required: true,
    },
    {
      key: "credentialsToken",
      label: "Bearer token / API key",
      placeholder: "(value pasted from the upstream admin console)",
      hint: "Persisted server-side; only the value is held in IngestionSource.pullConfig.credentials. Substituted into the header template at request time.",
      required: true,
      secret: true,
    },
    {
      key: "eventsJsonPath",
      label: "Events array JSONPath",
      placeholder: "$.data",
      hint: "JSONPath into the response body to extract the events array (e.g. $.data, $.events, $.value).",
      required: true,
    },
    {
      key: "cursorJsonPath",
      label: "Next-cursor JSONPath",
      placeholder: "$.next_cursor",
      hint: "JSONPath to the pagination cursor in the response. Set to a path that yields null/missing when drained.",
      required: true,
    },
    {
      key: "cursorQueryParam",
      label: "Cursor query parameter name",
      placeholder: "cursor",
      hint: "Query-param name the upstream API expects on subsequent pages. Defaults to 'cursor'. Common alternatives: next_token, pageToken, $skiptoken.",
    },
    {
      key: "eventMappingDsl",
      label: "Event mapping (key=jsonpath per line)",
      placeholder:
        "source_event_id=$.id\nevent_timestamp=$.created_at\nactor=$.user.email\naction=$.event_type\ntarget=$.target.name",
      hint: "Required keys: source_event_id, event_timestamp, actor, action, target. Optional: cost_usd, tokens_input, tokens_output. Each line maps an OCSF field to a JSONPath into one event.",
      required: true,
    },
  ],
};

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
