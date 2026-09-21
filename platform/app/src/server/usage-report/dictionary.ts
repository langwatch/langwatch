/**
 * Every field a self-hosted install reports, declared once (ADR-141, section
 * 10).
 *
 * One list, read by two callers that used to drift: the report the sender
 * builds, and the docs page and the checkup screen that say what the report
 * carries. A field that is not here is not sent, and a field that is here is
 * documented, because both come from this file.
 *
 * Each field carries a category, which is GitLab's system and the thing a
 * customer's security review asks about:
 *
 *   standard      the identifiers that travel with any report
 *   operational   what is needed to run the service for this customer
 *   subscription  license compliance, and only on the license channel
 *   optional      everything else, and the default for a new field
 *
 * `optional` is separately switchable, and `hostname` has a switch of its own
 * because it names the customer's own network.
 *
 * What is never here, and never will be: trace or span content, prompts,
 * dataset contents, evaluation inputs and outputs, project names, user names,
 * raw email addresses, IP addresses, API keys, model provider keys. Company
 * identity is aggregated email domains with counts, never an address.
 */

/** Who a field is for, and what a customer may switch off. */
export const USAGE_FIELD_CATEGORIES = [
  "standard",
  "operational",
  "subscription",
  "optional",
] as const;

export type UsageFieldCategory = (typeof USAGE_FIELD_CATEGORIES)[number];

/** The stretch of time a count covers. */
export const USAGE_WINDOWS = [
  "lifetime",
  "7d",
  "28d",
  "point_in_time",
] as const;

export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export interface UsageField {
  /** The name on the wire, and the name on the docs page. */
  readonly key: string;
  readonly category: UsageFieldCategory;
  readonly window: UsageWindow;
  /** Why it is collected, in one sentence a customer reads on the docs page. */
  readonly why: string;
  /** Where the value comes from, for whoever maintains the reader. */
  readonly source: string;
  /**
   * Set on a field that is switchable on its own rather than with its
   * category. Only `hostname` is, because it names the customer's network.
   */
  readonly ownSwitch?: true;
}

/**
 * The version of this dictionary.
 *
 * Travels in the report, so a stored report can be read back against the list
 * that produced it rather than against the list running today. Raised whenever
 * a field is added, removed or changes meaning.
 */
export const USAGE_REPORT_SCHEMA_VERSION = 2;

/** Every field, in the order the docs page lists them. */
export const USAGE_FIELDS: readonly UsageField[] = [
  // --- standard -----------------------------------------------------------
  {
    key: "instance_id",
    category: "standard",
    window: "point_in_time",
    why: "Tells one install apart from another, so two reports can be read as one install changing over time rather than two installs.",
    source: "InstanceIdentity.instanceId",
  },
  {
    key: "report_schema_version",
    category: "standard",
    window: "point_in_time",
    why: "Says which version of this dictionary produced the report, so a stored report is read back against the list that made it.",
    source: "USAGE_REPORT_SCHEMA_VERSION",
  },
  {
    key: "version",
    category: "standard",
    window: "point_in_time",
    why: "The release this install runs, so a bug report can be matched to a build and an upgrade notice can reach the installs that need it.",
    source: "SERVICE_VERSION",
  },
  {
    key: "install_method",
    category: "standard",
    window: "point_in_time",
    why: "How this install was deployed, so the installation instructions that are actually used get the attention.",
    source: "INSTALL_METHOD",
  },
  {
    key: "chart_version",
    category: "standard",
    window: "point_in_time",
    why: "The Helm chart release, which moves separately from the app and is the other half of a deployment problem.",
    source: "LANGWATCH_CHART_VERSION",
  },
  {
    key: "environment",
    category: "standard",
    window: "point_in_time",
    why: "Whether this is a production install or somebody trying it out, so the two are not counted together.",
    source: "NODE_ENV",
  },
  {
    key: "first_seen_at",
    category: "standard",
    window: "point_in_time",
    why: "When this install first minted its identity, which is how long it has been running.",
    source: "InstanceIdentity.createdAt",
  },
  {
    key: "timestamp",
    category: "standard",
    window: "point_in_time",
    why: "When the report was taken, so a late arrival is not read as current.",
    source: "the clock at collection",
  },

  // --- operational --------------------------------------------------------
  {
    key: "organizations",
    category: "operational",
    window: "point_in_time",
    why: "How many organizations share this install, which decides whether an install is one customer or a platform.",
    source: "Organization",
  },
  {
    key: "teams",
    category: "operational",
    window: "point_in_time",
    why: "How the install is divided up, which is what team-level features have to work against.",
    source: "Team",
  },
  {
    key: "projects",
    category: "operational",
    window: "point_in_time",
    why: "How many projects the install carries, which is the unit most limits and most screens are scoped to.",
    source: "Project",
  },
  {
    key: "users",
    category: "operational",
    window: "point_in_time",
    why: "How many people use the install, which is what support and seat questions start from.",
    source: "OrganizationUser",
  },
  {
    key: "auth_method",
    category: "operational",
    window: "point_in_time",
    why: "Which sign-in method is configured, so an authentication problem can be reproduced rather than guessed at.",
    source: "AUTH_PROVIDER",
  },
  {
    key: "sso_provider",
    category: "operational",
    window: "point_in_time",
    why: "The name of the identity provider in use, never its configuration or its secrets, so an SSO problem names the product it is about.",
    source: "Organization.ssoProvider",
  },
  {
    key: "connected",
    category: "operational",
    window: "point_in_time",
    why: "Whether this install's license names a hosted service, which decides what it may call and which host answers it.",
    source: "the signed license",
  },

  // --- optional: who ------------------------------------------------------
  {
    key: "user_email_domains",
    category: "optional",
    window: "point_in_time",
    why: "The company running the install, as domains with counts (acme.com: 14). Never an address, and never a name. It is how we know who to support and who to talk to, and it is the field to switch off first if you would rather we did not.",
    source: "User.email, the part after the @, counted",
  },
  {
    key: "hostname",
    category: "optional",
    window: "point_in_time",
    why: "The address this install answers on, which tells a support conversation apart from a test. It names your own network, so it has a switch of its own.",
    source: "BASE_HOST",
    ownSwitch: true,
  },

  // --- optional: the onboarding ladder ------------------------------------
  {
    key: "first_project_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install got its first project, the first rung of getting started.",
    source: "min(Project.createdAt)",
  },
  {
    key: "first_member_at",
    category: "optional",
    window: "point_in_time",
    why: "When a second person joined, which is when an install stops being one person trying it out.",
    source: "the second OrganizationUser.createdAt",
  },
  {
    key: "first_dataset_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install got its first dataset, which is the rung most installs stall on.",
    source: "min(Dataset.createdAt)",
  },
  {
    key: "first_evaluation_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install first ran an evaluation, which is what most people came for.",
    source: "min(BatchEvaluation.createdAt)",
  },
  {
    key: "first_monitor_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install first set up a monitor, which is when evaluation became continuous rather than a one-off.",
    source: "min(Monitor.createdAt)",
  },
  {
    key: "first_prompt_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install first saved a prompt.",
    source: "min(LlmPromptConfig.createdAt)",
  },
  {
    key: "first_workflow_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install first built a workflow in the optimization studio.",
    source: "min(Workflow.createdAt)",
  },
  {
    key: "first_model_provider_at",
    category: "optional",
    window: "point_in_time",
    why: "When a model provider was first configured, without which most of the product does nothing.",
    source: "min(ModelProvider.createdAt)",
  },
  {
    key: "first_annotation_at",
    category: "optional",
    window: "point_in_time",
    why: "When somebody first reviewed a trace by hand.",
    source: "min(Annotation.createdAt)",
  },
  {
    key: "first_trigger_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install first set up an alert.",
    source: "min(Trigger.createdAt)",
  },
  {
    key: "first_experiment_at",
    category: "optional",
    window: "point_in_time",
    why: "When the install first ran an experiment.",
    source: "min(Experiment.createdAt)",
  },

  // --- optional: what they do, lifetime and windowed ----------------------
  ...lifetimeAndWindows({
    key: "traces",
    why: "How much the install ingests, which is the one number that says whether it is in production.",
    source: "trace_summaries, counted per organization and added up",
    lifetimeKey: "totalTraces",
  }),
  ...lifetimeAndWindows({
    key: "scenario_runs",
    why: "How much simulation testing the install does.",
    source: "simulation_runs, deduplicated by run",
    lifetimeKey: "totalScenarioEvents",
  }),
  ...lifetimeAndWindows({
    key: "annotations",
    why: "How much reviewing by hand happens, which is the signal that a team is reading its own traces.",
    source: "Annotation",
  }),
  ...lifetimeAndWindows({
    key: "batch_evaluations",
    why: "How many evaluation runs the install has done.",
    source: "BatchEvaluation",
    lifetimeKey: "batchEvaluations",
  }),
  ...lifetimeAndWindows({
    key: "datasets",
    why: "How many datasets the install holds.",
    source: "Dataset",
  }),
  ...lifetimeAndWindows({
    key: "dataset_records",
    why: "How big those datasets are, which is what dataset performance work is sized against.",
    source: "DatasetRecord",
    lifetimeKey: "datasetRecords",
  }),
  ...lifetimeAndWindows({
    key: "experiments",
    why: "How many experiments the install has run.",
    source: "Experiment",
  }),
  ...lifetimeAndWindows({
    key: "prompts",
    why: "How many prompts the install manages here rather than in its own code.",
    source: "LlmPromptConfig",
  }),
  ...lifetimeAndWindows({
    key: "monitors",
    why: "How many continuous evaluations are configured.",
    source: "Monitor",
  }),
  ...lifetimeAndWindows({
    key: "workflows",
    why: "How many optimization studio workflows exist.",
    source: "Workflow",
  }),
  ...lifetimeAndWindows({
    key: "triggers",
    why: "How many alerts are configured.",
    source: "Trigger",
  }),
  {
    key: "annotationQueues",
    category: "optional",
    window: "lifetime",
    why: "How many review queues exist, which says whether reviewing is a workflow or an occasional thing.",
    source: "AnnotationQueue",
  },
  {
    key: "annotationQueueItems",
    category: "optional",
    window: "lifetime",
    why: "How much has gone through those queues.",
    source: "AnnotationQueueItem",
  },
  {
    key: "annotationScores",
    category: "optional",
    window: "lifetime",
    why: "How many scores reviewers recorded.",
    source: "AnnotationScore",
  },
  {
    key: "customGraphs",
    category: "optional",
    window: "lifetime",
    why: "How many charts were built, which says whether the analytics surface is used.",
    source: "CustomGraph, builder charts only",
  },
  {
    key: "active_users_28d",
    category: "optional",
    window: "28d",
    why: "How many people signed in over four weeks, which is the difference between an install that is running and one that is used.",
    source: "Session.expires, counted distinct by user",
  },
  {
    key: "active_projects_28d",
    category: "optional",
    window: "28d",
    why: "How many projects saw activity over four weeks, which separates a live project from a folder nobody opened.",
    source: "Project.updatedAt",
  },

  // --- optional: how they run it ------------------------------------------
  {
    key: "model_providers",
    category: "optional",
    window: "point_in_time",
    why: "Which model providers are configured, by name only. Never a key, never an endpoint, never a deployment name.",
    source: "ModelProvider.provider, distinct",
  },
  {
    key: "storage_backend",
    category: "optional",
    window: "point_in_time",
    why: "Where stored objects go, so a storage problem names the backend it is about.",
    source: "the resolved storage configuration",
  },
  {
    key: "email_configured",
    category: "optional",
    window: "point_in_time",
    why: "Whether the install can send email, because an install that cannot send email cannot invite anyone and will look abandoned.",
    source: "EMAIL_PROVIDER",
  },
  {
    key: "gateway_configured",
    category: "optional",
    window: "point_in_time",
    why: "Whether the AI gateway is set up, which decides whether model traffic is routed or only observed.",
    source: "LW_GATEWAY_BASE_URL",
  },
];

/**
 * A count in all three stretches of time.
 *
 * The lifetime total is the number that has always been reported, and it
 * answers almost nothing on its own: an install that ingested a million traces
 * two years ago and none since reads the same as one ingesting a million a
 * week. The two windows are what make it usable.
 */
function lifetimeAndWindows({
  key,
  why,
  source,
  lifetimeKey,
}: {
  key: string;
  why: string;
  source: string;
  /** Where the lifetime total already had a name on the wire. */
  lifetimeKey?: string;
}): UsageField[] {
  return [
    {
      key: lifetimeKey ?? key,
      category: "optional",
      window: "lifetime",
      why,
      source,
    },
    {
      key: `${key}_7d`,
      category: "optional",
      window: "7d",
      why: `${why} Over the last seven days.`,
      source,
    },
    {
      key: `${key}_28d`,
      category: "optional",
      window: "28d",
      why: `${why} Over the last twenty-eight days.`,
      source,
    },
  ];
}

/** Every field of one category, for the docs page and the checkup screen. */
export function usageFieldsOfCategory(
  category: UsageFieldCategory,
): UsageField[] {
  return USAGE_FIELDS.filter((field) => field.category === category);
}

/** The field with this wire name, for a reader checking one. */
export function usageField(key: string): UsageField | undefined {
  return USAGE_FIELDS.find((field) => field.key === key);
}

/**
 * What is never collected, stated rather than implied.
 *
 * On the docs page word for word, because a list of what a report does carry
 * never answers the question a security review is actually asking.
 */
export const USAGE_NEVER_COLLECTED: readonly string[] = [
  "Trace or span content, in any form",
  "Prompts, whether saved here or sent through the gateway",
  "Dataset contents",
  "Evaluation inputs and outputs",
  "Project names",
  "User names",
  "Email addresses (only the domain after the @, counted)",
  "IP addresses",
  "API keys, model provider keys, or any other credential",
];
