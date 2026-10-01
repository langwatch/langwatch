// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every signal an owner records for nurturing: ids plus what the owner's event
 * holds, one member per kind main sent. Nurturing fetches nothing.
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import {
  guidedOnboardingStateSchema,
  guidedPathSchema,
  onboardingVariantSchema,
} from "@langwatch/onboarding-contract";
import {
  integrationMethodSelectionSchema,
  nurturingSignUpDataSchema,
} from "@langwatch/organization-contract";
import { z } from "zod";

/** The owner's event a signal was raised from: it is sent once per kind and source event. */
const signalSource = {
  sourceEventId: z.string().min(1),
  /** The source event's tenant. */
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
};

const id = z.string().min(1);
const optionalText = z.string().nullish();

/** Where the organization's onboarding experiment put it; absent for older or self-hosted ones. */
const variant = onboardingVariantSchema.nullish();

/** The CRM events a self-hosted install's lead signals are tracked as. */
export const selfHostedSignalEventSchema = z.enum([
  "self_hosted_seats_crossed_threshold",
  "self_hosted_sustained_ingestion",
  "self_hosted_licensed_feature_without_license",
  "self_hosted_license_expiring",
  "self_hosted_domain_has_cloud_account",
  "self_hosted_license_sync_stale",
]);

/** The organization traits a self-hosted install's latest report reads as. */
export const selfHostedOrgTraitsSchema = z.object({
  self_hosted: z.boolean(),
  self_hosted_version: z.string().optional(),
  self_hosted_install_method: z.string().optional(),
  self_hosted_users: z.number().optional(),
  self_hosted_projects: z.number().optional(),
  self_hosted_traces_28d: z.number().optional(),
  self_hosted_active_users_28d: z.number().optional(),
  self_hosted_first_seen_at: z.string().optional(),
  self_hosted_last_report_at: z.string().optional(),
  self_hosted_signals: z.string().optional(),
});

/** An organization-wide count taken by the owner when it recorded, this one included. */
const countIncludingThis = z.number().int().positive();

export const nurturingSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("scenario_created"),
    ...signalSource,
    userId: id,
    projectId: id,
    scenarioId: id,
    scenarioCount: z.number().int().nonnegative(),
    onboardingVariant: variant,
  }),
  z.object({
    kind: z.literal("scenario_run_succeeded"),
    ...signalSource,
    /** The organization's admin: the person posthog-js identifies in the browser. */
    userId: id,
    projectId: id,
    scenarioId: z.string().nullish(),
    runId: id,
    onboardingVariant: variant,
  }),
  z.object({
    kind: z.literal("workflow_created"),
    ...signalSource,
    userId: id,
    projectId: id,
    workflowId: id,
    workflowCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("first_trace_integrated"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    sdkLanguage: z.string(),
    sdkFramework: z.string(),
  }),
  z.object({
    kind: z.literal("trace_received"),
    ...signalSource,
    /** The organization's admin. `occurredAt` is the trace's. */
    userId: id,
    projectId: id,
  }),
  z.object({
    kind: z.literal("simulation_run_finished"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    /** Counted by nurturing since the cutover, including this one. */
    organizationRunCount: countIncludingThis,
    /** The organization's first: never for one learned from project's backfill. */
    first: z.boolean(),
  }),
  z.object({
    kind: z.literal("evaluation_completed"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    evaluationId: id,
    evaluatorType: z.string().nullish(),
    score: z.number().nullish(),
    passed: z.boolean().nullish(),
    /** Counted by nurturing since the cutover, including this one. */
    organizationEvaluationCount: countIncludingThis,
    /** The organization's first: never for one learned from project's backfill. */
    first: z.boolean(),
  }),
  z.object({
    kind: z.literal("experiment_ran"),
    ...signalSource,
    userId: id,
    projectId: id,
    experimentId: z.string().nullish(),
    /** Main told Customer.io only of a full run of a saved experiment. */
    fullRun: z.boolean(),
  }),
  z.object({ kind: z.literal("evaluation_ran"), ...signalSource, userId: id, projectId: id }),
  z.object({
    kind: z.literal("prompt_created"),
    ...signalSource,
    userId: id,
    projectId: id,
    /** The organization's prompts counting this one; one means it was the first. */
    orgPromptCount: countIncludingThis,
  }),
  z.object({
    kind: z.literal("signed_up"),
    ...signalSource,
    userId: id,
    organizationId: id,
    organizationName: z.string(),
    signUpData: nurturingSignUpDataSchema.nullish(),
    primaryIntent: optionalText,
  }),
  z.object({
    kind: z.literal("team_member_invited"),
    ...signalSource,
    userId: id,
    /** The organization's members plus every pending invite, this batch included. */
    teamMemberCount: z.number().int().nonnegative(),
    /** One role per invite the batch created. */
    roles: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("invite_accepted"),
    ...signalSource,
    userId: id,
    organizationId: id,
    organizationName: z.string(),
  }),
  z.object({
    kind: z.literal("sso_auto_added"),
    ...signalSource,
    userId: id,
    organizationId: id,
    organizationName: z.string(),
  }),
  z.object({
    kind: z.literal("session_started"),
    ...signalSource,
    userId: id,
    /** False while onboarding is unfinished: nothing is sent, so no ghost person is made. */
    hasOrganization: z.boolean(),
  }),
  z.object({
    kind: z.literal("integration_method_chosen"),
    ...signalSource,
    userId: id,
    selection: integrationMethodSelectionSchema,
  }),
  z.object({
    kind: z.literal("guided_onboarding_paths"),
    ...signalSource,
    userId: id,
    organizationId: id,
    event: z.enum(["paths_selected", "path_begun"]),
    previousPaths: z.array(guidedPathSchema),
    paths: z.array(guidedPathSchema),
  }),
  z.object({
    kind: z.literal("guided_onboarding_progress"),
    ...signalSource,
    userId: id,
    organizationId: id,
    event: z.enum(["provider_connected", "tour_completed", "tour_skipped", "path_completed"]),
    payload: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number()])),
    state: guidedOnboardingStateSchema,
  }),
  z.object({
    kind: z.literal("subscription_changed"),
    ...signalSource,
    organizationId: id,
    /** Every member of the organization, each told the trait. */
    memberUserIds: z.array(id),
    hasSubscription: z.boolean(),
  }),
  z.object({
    kind: z.literal("checkout_completed"),
    ...signalSource,
    organizationId: id,
    subscriptionId: id,
    /** ISO instant the checkout session was created. */
    checkoutCreatedAt: z.string(),
  }),
  z.object({
    kind: z.literal("self_hosted_crm"),
    ...signalSource,
    userId: id,
    organizationId: id,
    instanceId: id,
    traits: selfHostedOrgTraitsSchema,
    events: z.array(selfHostedSignalEventSchema),
  }),
  z.object({
    kind: z.literal("project_active_day"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    source: z.string(),
    daysSinceSignup: z.number().int().nonnegative().nullish(),
    onboardingVariant: variant,
  }),
]);
export type NurturingSignal = z.infer<typeof nurturingSignalSchema>;
export type NurturingSignalOf<Kind extends NurturingSignal["kind"]> = Extract<
  NurturingSignal,
  { kind: Kind }
>;
