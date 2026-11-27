// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every signal an owner records for nurturing: ids plus what the owner's event
 * holds, one member per kind main sent.
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { Named } from "@langwatch/module";
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
const selfHostedOrgTraitsSchemaDefinition = z.object({
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
export interface SelfHostedOrgTraitsSchema extends Named<
  typeof selfHostedOrgTraitsSchemaDefinition
> {}
export const selfHostedOrgTraitsSchema: SelfHostedOrgTraitsSchema =
  selfHostedOrgTraitsSchemaDefinition;

/** The insight acts nurturing tells PostHog of: renewed names no person, so it is left out. */
export const INSIGHT_ACTS = ["filed", "seen", "archived", "kept"] as const;
/** How an insight was filed and its tone: insight's own values, held here so no insight code loads. */
export const INSIGHT_SIGNAL_FILED_VIA = ["chat", "run"] as const;
export const INSIGHT_SIGNAL_TONES = ["bad", "watch", "good"] as const;

/** An organization-wide count taken by the owner when it recorded, this one included. */
const countIncludingThis = z.number().int().positive();

const nurturingSignalSchemaDefinition = z.discriminatedUnion("kind", [
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
    /** The latest of the evaluations this signal counts; its type, score and verdict follow. */
    evaluationId: id,
    /** The organization counted against; optional because a signal recorded before it was named is re-parsed. */
    organizationId: id.optional(),
    evaluatorType: z.string().nullish(),
    score: z.number().nullish(),
    passed: z.boolean().nullish(),
    /** The project's evaluations one batch counted together; absent on a signal from before batching. */
    evaluationsCounted: countIncludingThis.optional(),
    /** Counted by nurturing since the cutover, including these. */
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
    /** The OrganizationUserRole joined with; absent on events stored before it was recorded. */
    role: z.string().optional(),
  }),
  z.object({
    /** An admin moved a member to another seat: the person's seat is told, never a join. */
    kind: z.literal("member_role_changed"),
    ...signalSource,
    userId: id,
    organizationId: id,
    /** The OrganizationUserRole now held; a plain string so an unknown role still parses. */
    role: z.string(),
    previousRole: z.string().optional(),
  }),
  z.object({
    /** A person admitted by a path with no joined fact of its own: their seat and Company link. */
    kind: z.literal("member_admitted"),
    ...signalSource,
    userId: id,
    organizationId: id,
    /** The OrganizationUserRole admitted with; a plain string so an unknown role still parses. */
    role: z.string(),
  }),
  z.object({
    kind: z.literal("sso_auto_added"),
    ...signalSource,
    userId: id,
    organizationId: id,
    organizationName: z.string(),
    /** The OrganizationUserRole joined with; absent on events stored before it was recorded. */
    role: z.string().optional(),
  }),
  z.object({
    /** A person's own sign-up, from user's or auth's fact: PostHog's signed_up, never Customer.io's. */
    kind: z.literal("user_registered"),
    ...signalSource,
    userId: id,
  }),
  z.object({
    /** An account minted by any path, from user's created fact: identify only, never signed_up. */
    kind: z.literal("user_created"),
    ...signalSource,
    userId: id,
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
    payload: z
      .record(z.string(), z.union([z.string(), z.array(z.string()), z.number()]))
      .optional(),
  }),
  z.object({
    kind: z.literal("guided_onboarding_progress"),
    ...signalSource,
    userId: id,
    organizationId: id,
    event: z.enum([
      "provider_connected",
      "provider_skipped",
      "tour_completed",
      "tour_skipped",
      "tour_replayed",
      "path_completed",
      "start_chosen",
    ]),
    payload: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number()])),
    state: guidedOnboardingStateSchema,
  }),
  z.object({
    kind: z.literal("onboarding_variant_assigned"),
    ...signalSource,
    /** The person who created the organization. */
    userId: id,
    organizationId: id,
    variant: onboardingVariantSchema,
  }),
  z.object({
    kind: z.literal("subscription_changed"),
    ...signalSource,
    organizationId: id,
    /** Every member of the organization, each told the trait. */
    memberUserIds: z.array(id),
    hasSubscription: z.boolean(),
    /** Billing's plan type; absent on a fact billing stored before it carried one. */
    plan: id.optional(),
    /** Billing's resync restated it: sent at once, unclaimed, and failing when not delivered. */
    fromCatchUp: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("subscription_started"),
    ...signalSource,
    organizationId: id,
    /** Every member of the organization, each tracked the event. */
    memberUserIds: z.array(id),
    plan: id,
  }),
  z.object({
    /** A Free organization reached the monthly scenario run threshold; once per month. */
    kind: z.literal("scenario_runs_threshold_reached"),
    ...signalSource,
    organizationId: id,
    memberUserIds: z.array(id),
    runs: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    month: id,
  }),
  z.object({
    /** A Free organization's grace after its first scenario run ended; once. */
    kind: z.literal("scenario_run_grace_ended"),
    ...signalSource,
    organizationId: id,
    memberUserIds: z.array(id),
    graceEndedAt: z.number().int().nonnegative(),
    runLimit: z.number().int().nonnegative(),
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
  z.object({
    kind: z.literal("coding_session_stored"),
    ...signalSource,
    /** The organization's admin. `occurredAt` is the session's. */
    userId: id,
    projectId: id,
  }),
  z.object({
    /** A session from a personal project: its owner's own profile, never the organization's. */
    kind: z.literal("own_coding_session_stored"),
    ...signalSource,
    /** The personal project's owner. `occurredAt` is the batch's latest session. */
    userId: id,
    projectId: id,
    /** The batch's earliest session, epoch ms: own_coding_first_session_at if none is set yet. */
    firstOccurredAt: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("coding_active_days"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    /** UTC days with a coding-agent session, counted by nurturing, this one included. */
    codingActiveDays: countIncludingThis,
  }),
  z.object({
    kind: z.literal("coding_agent_types"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    /** Every agent the organization has used, sorted. */
    agentTypes: z.array(id).min(1),
  }),
  z.object({
    kind: z.literal("coding_terminal_types"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    /** Every terminal type the organization's sessions ran in, sorted. */
    terminalTypes: z.array(id).min(1),
  }),
  z.object({
    kind: z.literal("coding_repo_count"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    /** Distinct repos of the organization's sessions: the count alone, never a per-repo value. */
    codingRepoCount: countIncludingThis,
  }),
  z.object({
    kind: z.literal("coding_session_days_first_3"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    projectId: id,
    /** Distinct UTC days among days 0, 1 and 2 from the organization's creation with a session. */
    codingSessionDaysFirst3: z.number().int().min(1).max(3),
  }),
  z.object({
    kind: z.literal("coding_agent_first_session"),
    ...signalSource,
    /** The organization's admin. `occurredAt` is the first session's. */
    userId: id,
    projectId: id,
    agentType: id,
    agentTypes: z.array(id).min(1),
    /** Every active member of the organization: each gets uses_coding_agent. */
    memberUserIds: z.array(id).default([]),
  }),
  z.object({
    /** The opening person's own profile, not the organization admin's. */
    kind: z.literal("app_opened"),
    ...signalSource,
    userId: id,
    page: id,
  }),
  z.object({
    /** A person's act on their own insight; a filing carries its bounded facts, never its text. */
    kind: z.literal("insight_acted"),
    ...signalSource,
    userId: id,
    projectId: id,
    act: z.enum(INSIGHT_ACTS),
    filedVia: z.enum(INSIGHT_SIGNAL_FILED_VIA).nullish(),
    tone: z.enum(INSIGHT_SIGNAL_TONES).nullish(),
    fromBoard: z.boolean().nullish(),
  }),
  z.object({
    kind: z.literal("sessions_page_viewed"),
    ...signalSource,
    userId: id,
    page: id,
  }),
  z.object({
    /** A usage, cost or plan page open: moves the person's usage_page_viewed_at. */
    kind: z.literal("usage_page_opened"),
    ...signalSource,
    userId: id,
    page: id,
  }),
  z.object({
    /** The same open as the event Customer.io receives only for the person's first. */
    kind: z.literal("usage_page_viewed"),
    ...signalSource,
    userId: id,
    page: id,
  }),
  z.object({
    /** Langy completed an answer in a conversation the person owns; set once per person. */
    kind: z.literal("langy_first_message_seen"),
    ...signalSource,
    userId: id,
  }),
  z.object({
    /** Gateway created a person's key. `sourceEventId` is the key and `created`, once per key. */
    kind: z.literal("virtual_key_created"),
    ...signalSource,
    /** The key's holder, else its creator, else the organization's admin. */
    userId: id,
    organizationId: id,
    virtualKeyId: id,
    keyName: z.string(),
    /** False for the admin told in place of the key's holder and maker: no `has_virtual_key`. */
    recipientHoldsKey: z.boolean(),
  }),
  z.object({
    /** A person's key crossed its budget's warn line or limit, once per crossing and period. */
    kind: z.literal("key_budget_threshold"),
    ...signalSource,
    /** The key's holder, else its creator, else the organization's admin. */
    userId: id,
    organizationId: id,
    virtualKeyId: id,
    keyName: z.string(),
    limitUsd: z.number(),
    spentUsd: z.number(),
    /** At or over the limit, not only the warn line. */
    reached: z.boolean(),
    onBreach: z.enum(["block", "warn"]),
    window: id,
    scopeType: id,
    /** ISO-8601 UTC; null for a window that never rolls; absent when gateway named no end. */
    periodEnd: z.string().nullish(),
    /** The model the key spent most on this period; absent when gateway named none. */
    topModel: z.string().nullish(),
    /** That model's share of the key's spend as a whole percent, 0 to 100; absent with it. */
    topModelShare: z.number().nullish(),
  }),
  z.object({
    /** A person's key served its first request. `sourceEventId` is the key and `first_request`. */
    kind: z.literal("key_first_request"),
    ...signalSource,
    /** Whoever the key's creation goes to: its holder, else its creator, else the admin. */
    userId: id,
    organizationId: id,
    virtualKeyId: id,
  }),
  z.object({
    /**
     * An organization's person keys spent without a budget this week. `sourceEventId` is
     * `<organization>:unbudgeted:<ISO week>`, once per organization per week.
     */
    kind: z.literal("gateway_spend_without_budget"),
    ...signalSource,
    /** The organization's admin. */
    userId: id,
    organizationId: id,
    /** The keys that spent most, most first, at most five. */
    keys: z.array(z.object({ name: z.string(), spendUsd: z.number() })),
    /** Every key that spent without a budget, named or not. */
    keyCount: z.number().int().positive(),
    totalSpendUsd: z.number(),
  }),
  z.object({
    /** An organization connected a governance source. `sourceEventId` is `<source>:connected`. */
    kind: z.literal("governance_source_connected"),
    ...signalSource,
    /** The source's creator while a current member, else the organization's admin. */
    userId: id,
    organizationId: id,
    sourceId: id,
    sourceType: id,
  }),
  z.object({
    /** A governance source took its first data. `sourceEventId` is `<source>:live`, once. */
    kind: z.literal("governance_source_live"),
    ...signalSource,
    /** The source's creator while a current member, else the organization's admin. */
    userId: id,
    organizationId: id,
    sourceId: id,
    sourceType: id,
  }),
]);
export interface NurturingSignalSchema extends Named<typeof nurturingSignalSchemaDefinition> {}
export const nurturingSignalSchema: NurturingSignalSchema = nurturingSignalSchemaDefinition;
export type NurturingSignal = z.infer<typeof nurturingSignalSchema>;
export type NurturingSignalOf<Kind extends NurturingSignal["kind"]> = Extract<
  NurturingSignal,
  { kind: Kind }
>;
