/**
 * Customer.io trait schema contract.
 *
 * Defines the complete data model pushed to Customer.io by subscribers and hooks.
 * All call sites use these typed parameters instead of ad-hoc Record<string, unknown>.
 */

// ---------------------------------------------------------------------------
// Person traits (via /identify)
// ---------------------------------------------------------------------------

export interface CioPersonTraits {
  // Onboarding
  email: string;
  name: string;
  role: string;
  company_size: string;
  signup_usage: string;
  signup_solution: string;
  signup_feature_usage: string;
  utm_campaign: string;
  how_heard: string;
  createdAt: string;
  integration_method: string;
  /**
   * ADR-038 org intent ("agent_governance" | "llm_ops") for
   * governance-vs-LLMOps segmentation. Optional: conditionally set via
   * pickDefined, absent for legacy/no-intent signups.
   */
  primary_intent?: string;

  // Attribution (first-touch URL params — captured client-side, forwarded
  // via signUpData). Optional because callers always use
  // `Partial<CioPersonTraits>` and set them conditionally; marking them
  // required would lie about the runtime contract.
  lead_source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;

  // Trace milestones (customerIoTraceSync subscriber)
  has_traces: boolean;
  sdk_language: string;
  sdk_framework: string;
  first_trace_at: string;
  trace_count: number;
  daily_trace_count: number;
  last_trace_at: string;
  trace_count_updated_at: string;

  // Evaluation milestones (customerIoEvaluationSync subscriber)
  has_evaluations: boolean;
  evaluation_count: number;
  first_evaluation_at: string;
  last_evaluation_at: string;

  // Prompt milestones (prompt creation hook)
  has_prompts: boolean;
  prompt_count: number;

  // Simulation milestones (customerIoSimulationSync subscriber)
  has_simulations: boolean;
  simulation_count: number;
  first_simulation_at: string;
  last_simulation_at: string;

  // Feature adoption
  team_member_count: number;
  workflow_count: number;
  scenario_count: number;

  // Activity tracking
  last_active_at: string;

  // Billing
  plan: string;
  has_subscription: boolean;

  // Guided onboarding (guidedOnboarding hook and the first-login backfill).
  // "guided" | "classic"; absent for organizations that predate the experiment.
  onboarding_variant?: string;
  // Comma list of the picked paths in pick order, e.g. "gateway,llmops".
  onboarding_paths?: string;
  onboarding_primary_path?: string;
  guided_onboarding_provider?: string;
  // "completed" | "skipped"
  guided_onboarding_tour?: string;
  // Comma list of the paths whose setup completed.
  guided_onboarding_completed_paths?: string;
  guided_onboarding_completed_at?: string;
}

// ---------------------------------------------------------------------------
// Organization traits (via /group)
// ---------------------------------------------------------------------------

export interface CioOrgTraits {
  name: string;
  plan: string;
  company_size: string;
  member_count: number;
  project_count: number;
  onboarding_variant?: string;
  onboarding_paths?: string;
  onboarding_primary_path?: string;
  guided_onboarding_completed_paths?: string;

  // Self-hosted (ADR-139, section 10). Set from the daily usage report of an
  // install whose license binds it to this organization, so a customer running
  // LangWatch on their own infrastructure is segmented on what that install
  // actually does rather than on their Cloud account, which may be empty.
  /** Whether a self-hosted install reports against this organization. */
  self_hosted?: boolean;
  self_hosted_version?: string;
  /** docker, helm, or whatever the install says it was installed with. */
  self_hosted_install_method?: string;
  self_hosted_users?: number;
  self_hosted_projects?: number;
  self_hosted_traces_28d?: number;
  self_hosted_active_users_28d?: number;
  self_hosted_first_seen_at?: string;
  self_hosted_last_report_at?: string;
  /** Comma list of the signals raised so far, in the order they were raised. */
  self_hosted_signals?: string;
}

// ---------------------------------------------------------------------------
// Event names (via /track)
// ---------------------------------------------------------------------------

export type CioEventName =
  | "signed_up"
  | "first_trace_integrated"
  | "first_evaluation_created"
  | "evaluation_ran"
  | "scenario_created"
  | "team_member_invited"
  | "workflow_created"
  | "experiment_ran"
  | "first_prompt_created"
  | "first_simulation_ran"
  | "joined_via_invite"
  | "joined_via_sso"
  | "onboarding_paths_selected"
  | "onboarding_path_llmops"
  | "onboarding_path_coding_agents"
  | "onboarding_path_gateway"
  | "onboarding_path_governance"
  | "guided_onboarding_path_completed"
  // Self-hosted lead signals (ADR-139, section 10). One per install, not one
  // per report: a campaign keyed on these fires when something changed.
  | "self_hosted_seats_crossed_threshold"
  | "self_hosted_sustained_ingestion"
  | "self_hosted_licensed_feature_without_license"
  | "self_hosted_license_expiring"
  | "self_hosted_domain_has_cloud_account";

// ---------------------------------------------------------------------------
// Batch call discriminated union
// ---------------------------------------------------------------------------

export type CioBatchCall =
  | {
      type: "identify";
      userId: string;
      traits: Partial<CioPersonTraits>;
    }
  | {
      type: "track";
      userId: string;
      event: CioEventName;
      properties?: Record<string, unknown>;
    }
  | {
      type: "group";
      userId: string;
      groupId: string;
      traits?: Partial<CioOrgTraits>;
    };
