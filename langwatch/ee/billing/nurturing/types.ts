/**
 * Customer.io trait schema contract.
 *
 * Defines the complete data model pushed to Customer.io by reactors and hooks.
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

  // Trace milestones (customerIoTraceSync reactor)
  has_traces: boolean;
  sdk_language: string;
  sdk_framework: string;
  first_trace_at: string;
  trace_count: number;
  daily_trace_count: number;
  last_trace_at: string;
  trace_count_updated_at: string;

  // Evaluation milestones (customerIoEvaluationSync reactor)
  has_evaluations: boolean;
  evaluation_count: number;
  first_evaluation_at: string;
  last_evaluation_at: string;

  // Prompt milestones (prompt creation hook)
  has_prompts: boolean;
  prompt_count: number;

  // Simulation milestones (customerIoSimulationSync reactor)
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
  | "first_simulation_ran";

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
