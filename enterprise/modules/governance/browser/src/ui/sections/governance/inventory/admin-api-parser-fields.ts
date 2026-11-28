// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defaultBackfillStart } from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import type { FieldDef } from "./parser-field-controls.ts";

export const OPENAI_ADMIN_FIELDS: FieldDef[] = [
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
];

export const CLAUDE_COMPLIANCE_FIELDS: FieldDef[] = [
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
];

export const ANTHROPIC_ADMIN_FIELDS: FieldDef[] = [
  {
    // `credentials*` prefix routes this into the encrypted `credentials`
    // subtree — same rule as the Genie token in `parser-field-catalog.ts`.
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
];
