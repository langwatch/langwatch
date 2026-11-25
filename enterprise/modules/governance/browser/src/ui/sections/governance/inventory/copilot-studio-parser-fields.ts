// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type FieldDef, switchFieldIsOn } from "./parser-field-controls.ts";

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

// Three groups, in the order admins care (issue #7775): where the
// environment lives, what it costs, and who may read its conversations.
// Grouping is presentational only — every key, secret flag and builder
// below is unchanged by it.
export const COPILOT_STUDIO_DATAVERSE_FIELDS: FieldDef[] = [
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
];
