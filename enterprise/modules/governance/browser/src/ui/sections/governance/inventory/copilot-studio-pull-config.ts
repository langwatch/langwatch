// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PULL_SCHEDULE_DEFAULTS } from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import {
  azureOneAppChosen,
  READ_DIRECTORY_DEFAULT_ON,
  READ_SEATS_DEFAULT_ON,
} from "./copilot-studio-parser-fields.ts";
import { switchFieldIsOn } from "./parser-field-controls.ts";
import type { ComposerState } from "./source-composer-state.ts";

/**
 * Why `buildCopilotStudioDataversePullConfig` refused, in the form's own field names. The billing
 * pair is named on its own: typed without the app registration it would replace the stored
 * credentials with half of them, and a refusal naming only the registration hides why.
 */
export function copilotStudioRefusalCopy(
  c: ComposerState,
  { shouldRequireCredentials }: { shouldRequireCredentials: boolean },
): string {
  if (shouldRequireCredentials) {
    return "The environment URL is required, plus all three parts of the app registration: tenant ID, client ID and client secret.";
  }
  const p = c.parserConfig;
  if (!normalizeEnvironmentUrl(p.environmentUrl ?? "")) return "The environment URL is required.";
  const registration: readonly (readonly [string | undefined, string])[] = [
    [p.credentialsTenantId, "tenant ID"],
    [p.credentialsClientId, "client ID"],
    [p.credentialsClientSecret, "client secret"],
  ];
  const missing = registration
    .filter(([value]) => (value ?? "").trim().length === 0)
    .map(([, label]) => label);
  if (
    missing.length === registration.length &&
    Object.keys(copilotAzureBillingFrom(p).credentials).length > 0
  ) {
    return "The billing app registration client ID and secret are stored together with the app registration, so enter them with the tenant ID, client ID and client secret, or clear both billing fields to keep the current credentials.";
  }
  return `The app registration is missing its ${joinFieldLabels(missing)}. Leave the tenant ID, client ID and client secret all blank to keep the current app registration, or enter all three to replace it.`;
}

function joinFieldLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * The pullConfig for a Copilot Studio source reading Dataverse.
 *
 * All three credential fields travel in the `credentials` subtree — the only
 * part of parserConfig the server encrypts — which is why they are named
 * `credentials*`. Without this builder the composer would fall through to the
 * bare `{ adapter }` default: the form would collect a client secret,
 * `parserFieldValue` would drop it as a secret, nothing would put it back, and
 * the source would save looking complete and fail every run for want of a
 * credential it did ask for.
 */
export function buildCopilotStudioDataversePullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const environmentUrl = normalizeEnvironmentUrl(p.environmentUrl ?? "");
  const tenantId = (p.credentialsTenantId ?? "").trim();
  const clientId = (p.credentialsClientId ?? "").trim();
  const clientSecret = (p.credentialsClientSecret ?? "").trim();
  if (!environmentUrl) return null;

  // All three or none: two thirds of an app registration is not a sign-in,
  // and accepting it would save a source that cannot run. On edit, none
  // means "keep the stored registration", so the key is omitted entirely.
  const registration = [tenantId, clientId, clientSecret];
  const isComplete = registration.every((value) => value.length > 0);
  const isBlank = registration.every((value) => value.length === 0);
  if (!isComplete && (shouldRequireCredentials || !isBlank)) return null;

  const billing = copilotAzureBillingFrom(p);
  // A billing pair typed without the registration would replace the whole
  // sealed subtree with half of it.
  if (isBlank && Object.keys(billing.credentials).length > 0) return null;
  return {
    adapter: "copilot_studio_dataverse",
    environmentUrl,
    // Empty means every agent the credential can see, which is what most
    // customers want and what covers a new agent the day someone makes one.
    botIds: (p.botIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    schedule:
      c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.copilot_studio_dataverse || "*/15 * * * *",
    ...billing.config,
    // A real boolean, because the adapter's schema is `z.boolean()` and would
    // refuse the form's string on every run. The default comes from the field
    // definition the switch renders from, so a form nobody touched saves the
    // state it was showing.
    readSeats: switchFieldIsOn({
      value: p.readSeats,
      defaultOn: READ_SEATS_DEFAULT_ON,
    }),
    // Same rule as `readSeats` above: a real boolean, from the same constant
    // the switch renders from, so an untouched form saves what it was showing.
    readDirectory: switchFieldIsOn({
      value: p.readDirectory,
      defaultOn: READ_DIRECTORY_DEFAULT_ON,
    }),
    ...(isComplete
      ? { credentials: { tenantId, clientId, clientSecret, ...billing.credentials } }
      : {}),
  };
}

/**
 * The environment address as the adapter reads it: trailing slashes dropped,
 * and `https://` put in front of a bare host name, which is how the address is
 * most often pasted. Stored without it, the source failed every pull (#9273).
 */
export function normalizeEnvironmentUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The Azure billing part of a Copilot Studio pullConfig: the subscription and
 * prepaid declaration for the config itself, and the billing identity's pair
 * for the encrypted credentials subtree.
 *
 * The subscription is omitted rather than sent empty, the same way Genie
 * omits an unset warehouse: the adapter reads "no subscription named" as "do
 * not read cost", and an empty string is a subscription id it would then ask
 * Azure about — and the schema would refuse it as not a uuid, failing the
 * save for a field the customer deliberately left blank. The prepaid flag
 * rides only beside a subscription: without a bill to read the declaration
 * has nothing to explain, and a stored `true` would spring back the day a
 * subscription is added — declared by nobody.
 *
 * The billing keys are present or absent, never empty strings, which
 * everything downstream would read as credentials. Whether the pair is
 * COMPLETE is judged server-side (`assertAzureBillHasItsOwnCredential`),
 * whose refusal names what is missing; the builder's job is only to not
 * manufacture values.
 *
 * With one app chosen (the form's default), the billing slots are COPIES of
 * the conversation pair, decided here at save time from the switch alone —
 * never from leftover billing values the form may still hold from a two-app
 * detour, which the form deliberately never clears. The choice itself is
 * written as `azureBillingUsesSameApp`, and only beside a subscription (same
 * rule as the prepaid flag): it is the only durable record — once the
 * credentials are sealed, equal-looking pairs cannot be told apart from a
 * deliberate second app with the same values.
 */
function copilotAzureBillingFrom(p: Record<string, string>): {
  config: Record<string, unknown>;
  credentials: Record<string, string>;
} {
  const azureSubscriptionId = (p.azureSubscriptionId ?? "").trim();
  const oneApp = azureOneAppChosen(p);

  const config: Record<string, unknown> = {};
  if (azureSubscriptionId) {
    config.azureSubscriptionId = azureSubscriptionId;
    config.azureBillingIsPrepaid = switchFieldIsOn({
      value: p.azureBillingIsPrepaid,
      defaultOn: false,
    });
    config.azureBillingUsesSameApp = oneApp;
  }

  return {
    config,
    credentials: copilotBillingCredentialsFrom({
      p,
      oneApp,
      hasBillToRead: azureSubscriptionId.length > 0,
    }),
  };
}

/**
 * Which values land in the billing credential slots, given the one-app
 * choice. One app: the conversation pair, and only when there is a bill to
 * read — never a speculative credential, and never the leftover billing
 * values a two-app detour may have left in form state. Two apps: what the
 * admin typed in the billing fields, exactly as before the switch existed.
 */
function copilotBillingCredentialsFrom({
  p,
  oneApp,
  hasBillToRead,
}: {
  p: Record<string, string>;
  oneApp: boolean;
  hasBillToRead: boolean;
}): Record<string, string> {
  if (oneApp && !hasBillToRead) return {};
  const source = oneApp
    ? { id: p.credentialsClientId, secret: p.credentialsClientSecret }
    : {
        id: p.credentialsBillingClientId,
        secret: p.credentialsBillingClientSecret,
      };

  const id = (source.id ?? "").trim();
  const secret = (source.secret ?? "").trim();
  const credentials: Record<string, string> = {};
  if (id) credentials.billingClientId = id;
  if (secret) credentials.billingClientSecret = secret;
  return credentials;
}
