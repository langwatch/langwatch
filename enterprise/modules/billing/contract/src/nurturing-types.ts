/**
 * Customer.io trait schema contract: the complete data model pushed to
 * Customer.io by nurturing integrations, typed instead of ad-hoc
 * `Record<string, unknown>`.
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

  // Trace milestones
  has_traces: boolean;

  // Evaluation milestones
  has_evaluations: boolean;

  // Prompt milestones (prompt creation hook)
  has_prompts: boolean;
  prompt_count: number;

  // Simulation milestones
  has_simulations: boolean;

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
}

// ---------------------------------------------------------------------------
// Event names (via /track)
// ---------------------------------------------------------------------------

export type CioEventName =
  | "signed_up"
  | "scenario_created"
  | "team_member_invited"
  | "workflow_created"
  | "experiment_ran"
  | "first_prompt_created"
  | "joined_via_invite"
  | "joined_via_sso"
  | "onboarding_paths_selected"
  | "onboarding_path_llmops"
  | "onboarding_path_coding_agents"
  | "onboarding_path_gateway"
  | "onboarding_path_governance"
  | "guided_onboarding_path_completed";

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
