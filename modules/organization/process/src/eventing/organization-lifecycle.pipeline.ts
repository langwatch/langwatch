import {
  CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE,
  checkoutCurrencySelectedEventDataSchema,
  PLAN_LIMIT_ALERT_SENT_EVENT_TYPE,
  planLimitAlertSentEventDataSchema,
  PRICING_MODEL_CHANGED_EVENT_TYPE,
  pricingModelChangedEventDataSchema,
  SEAT_CHECKOUT_PAID_EVENT_TYPE,
  SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE,
  seatCheckoutPaidEventDataSchema,
  seatCheckoutsAbandonedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
  selfHostedCustomerLicensedEventDataSchema,
} from "@langwatch/enterprise-licensing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  RecordCreatedCommand,
  RecordIntegrationMethodChosenCommand,
  RecordInviteAcceptedCommand,
  RecordMembersInvitedCommand,
  RecordMemberDisabledCommand,
  RecordPersonalWorkspaceProvisionedCommand,
  RecordPersonalTeamCreatedCommand,
  RecordPersonalWorkspaceArchivedCommand,
  RecordPersonalWorkspaceRevivedCommand,
  RecordPersonalWorkspaceFeaturesChangedCommand,
  RecordPresenceSettingChangedCommand,
  RecordSignedUpCommand,
  RecordTraceSharingDisabledCommand,
} from "./organization-lifecycle.commands.ts";
import {
  integrationMethodChosenEventSchema,
  inviteAcceptedEventSchema,
  membersInvitedEventSchema,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
  organizationCreatedEventSchema,
  organizationMemberDisabledEventSchema,
  organizationPresenceSettingChangedEventSchema,
  organizationSignedUpEventSchema,
  organizationTraceSharingDisabledEventSchema,
  personalWorkspaceProvisionedEventSchema,
  personalTeamCreatedEventSchema,
  personalWorkspaceArchivedEventSchema,
  personalWorkspaceRevivedEventSchema,
  personalWorkspaceFeaturesChangedEventSchema,
} from "./organization-lifecycle.events.ts";

/** Where billing's organisation-row facts land: organization's own writers (R42). */
export type BillingFactsApplier = Pick<
  OrganizationModule,
  | "updateSentPlanLimitAlert"
  | "updateCurrency"
  | "updatePricingModel"
  | "approvePaymentPendingInvites"
  | "cancelPaymentPendingInvites"
>;

/** Where licensing's customer facts land: organization creates the rows (C3c, R42). */
export type LicensingFactsApplier = Pick<OrganizationModule, "createSelfHostedCustomer">;

/** An organisation gone before its fact arrived has no row to apply it to. */
async function onLiveOrganization(apply: () => Promise<void>): Promise<void> {
  try {
    await apply();
  } catch (error) {
    if (!(error instanceof OrganizationNotFoundError)) throw error;
  }
}

function lifecycleCommands() {
  return definePipeline({
    name: ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: ORGANIZATION_AGGREGATE_TYPE }),
  })
    .withEvents([
      organizationSignedUpEventSchema,
      membersInvitedEventSchema,
      inviteAcceptedEventSchema,
      integrationMethodChosenEventSchema,
      personalWorkspaceProvisionedEventSchema,
      personalTeamCreatedEventSchema,
      personalWorkspaceArchivedEventSchema,
      personalWorkspaceRevivedEventSchema,
      personalWorkspaceFeaturesChangedEventSchema,
      organizationPresenceSettingChangedEventSchema,
      organizationTraceSharingDisabledEventSchema,
      organizationMemberDisabledEventSchema,
      organizationCreatedEventSchema,
    ])
    .withCommand("recordSignedUp", RecordSignedUpCommand)
    .withCommand("recordMembersInvited", RecordMembersInvitedCommand)
    .withCommand("recordInviteAccepted", RecordInviteAcceptedCommand)
    .withCommand("recordIntegrationMethodChosen", RecordIntegrationMethodChosenCommand)
    .withCommand("recordPersonalWorkspaceProvisioned", RecordPersonalWorkspaceProvisionedCommand)
    .withCommand("recordPersonalTeamCreated", RecordPersonalTeamCreatedCommand)
    .withCommand("recordPersonalWorkspaceArchived", RecordPersonalWorkspaceArchivedCommand)
    .withCommand("recordPersonalWorkspaceRevived", RecordPersonalWorkspaceRevivedCommand)
    .withCommand(
      "recordPersonalWorkspaceFeaturesChanged",
      RecordPersonalWorkspaceFeaturesChangedCommand,
    )
    .withCommand("recordPresenceSettingChanged", RecordPresenceSettingChangedCommand)
    .withCommand("recordTraceSharingDisabled", RecordTraceSharingDisabledCommand)
    .withCommand("recordMemberDisabled", RecordMemberDisabledCommand)
    .withCommand("recordCreated", RecordCreatedCommand);
}

export type OrganizationLifecycleDefinition = ReturnType<
  ReturnType<typeof lifecycleCommands>["build"]
>;

/**
 * organization_lifecycle records; peers (nurturing, governance) react from their own side (§9).
 * It applies billing's and licensing's writes to organisation rows from their facts (R42, C3c).
 */
export function buildOrganizationLifecyclePipeline({
  billingFacts,
  licensingFacts,
}: {
  billingFacts: BillingFactsApplier;
  licensingFacts: LicensingFactsApplier;
}): OrganizationLifecycleDefinition {
  return lifecycleCommands()
    .withPeerSubscriber("organizationLicensingSelfHostedCustomerLicensed", {
      eventType: SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
      data: selfHostedCustomerLicensedEventDataSchema,
      handle: ({ organizationId, name }) =>
        licensingFacts.createSelfHostedCustomer({ organizationId, name }),
    })
    .withPeerSubscriber("organizationBillingPlanLimitAlertSent", {
      eventType: PLAN_LIMIT_ALERT_SENT_EVENT_TYPE,
      data: planLimitAlertSentEventDataSchema,
      handle: ({ organizationId, sentAt }) =>
        onLiveOrganization(() =>
          billingFacts.updateSentPlanLimitAlert({
            organizationId,
            sentAt: Temporal.Instant.fromEpochMilliseconds(sentAt),
          }),
        ),
    })
    .withPeerSubscriber("organizationBillingCurrencySelected", {
      eventType: CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE,
      data: checkoutCurrencySelectedEventDataSchema,
      handle: ({ organizationId, currency }) =>
        onLiveOrganization(() => billingFacts.updateCurrency({ organizationId, currency })),
    })
    .withPeerSubscriber("organizationBillingPricingModelChanged", {
      eventType: PRICING_MODEL_CHANGED_EVENT_TYPE,
      data: pricingModelChangedEventDataSchema,
      handle: ({ organizationId, pricingModel }) =>
        onLiveOrganization(() => billingFacts.updatePricingModel({ organizationId, pricingModel })),
    })
    .withPeerSubscriber("organizationBillingSeatCheckoutPaid", {
      eventType: SEAT_CHECKOUT_PAID_EVENT_TYPE,
      data: seatCheckoutPaidEventDataSchema,
      handle: ({ organizationId, subscriptionId }) =>
        billingFacts.approvePaymentPendingInvites({ organizationId, subscriptionId }),
    })
    .withPeerSubscriber("organizationBillingSeatCheckoutsAbandoned", {
      eventType: SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE,
      data: seatCheckoutsAbandonedEventDataSchema,
      handle: ({ organizationId, subscriptionIds }) =>
        billingFacts.cancelPaymentPendingInvites({ organizationId, subscriptionIds }),
    })
    .build();
}

export const organizationLifecycleEventing = defineEventingModule({
  pipeline: ORGANIZATION_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
