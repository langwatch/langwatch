import type { VariableInfo } from "../editors/liquidMonaco";

/**
 * Client-side template scaffold. The defaults + the advertised variable list
 * are static server constants — fetching them across the wire just to render
 * an editor was wasted latency (and was leaving the Configuration secondary
 * stuck on a spinner when the round-trip stalled). Keeping a paired
 * `__tests__/scaffold.unit.test.ts` that imports the server-side originals
 * and asserts deep-equality means the two copies can't silently drift.
 *
 * Source of truth lives at:
 *   `src/server/event-sourcing/outbox/templating/defaults.ts`
 *   `src/server/event-sourcing/outbox/templating/exampleContext.ts`
 */

export const DEFAULT_EMAIL_SUBJECT_TEMPLATE =
  "{% if trigger.alertType %}({{ trigger.alertType }}) {% endif %}Trigger - {{ trigger.name }}";

export const DEFAULT_EMAIL_BODY_TEMPLATE = `# {% if trigger.alertType %}({{ trigger.alertType }}) {% endif %}{{ trigger.name }}

This automation fired against a matching trace.
{% if trigger.message %}

> {{ trigger.message }}
{% endif %}
{% if match.evaluation and match.evaluation.evaluatorName %}

**{{ match.evaluation.evaluatorName }}**{% if match.evaluation.score != null %} — score {{ match.evaluation.score }}{% endif %}{% if match.evaluation.label %} ({{ match.evaluation.label }}){% endif %}{% if match.evaluation.passed == false %} — **failed**{% endif %}
{% endif %}

**Input**
> {{ match.trace.input | truncate: 400 }}

**Output**
> {{ match.trace.output | truncate: 400 }}

[View matched trace ↗]({{ match.trace.url }})`;

export const DEFAULT_SLACK_TEMPLATE = `{% if trigger.alertType == 'INFO' %}ℹ️{% elsif trigger.alertType == 'WARNING' %}⚠️{% elsif trigger.alertType == 'CRITICAL' %}🔴{% else %}🔔{% endif %} *{{ trigger.name }}*{% if trigger.alertType %} _({{ trigger.alertType }})_{% endif %}
{% if trigger.message %}
> {{ trigger.message }}
{% endif %}
*Input:* {{ match.trace.input | truncate: 200 }}
*Output:* {{ match.trace.output | truncate: 200 }}{% if match.evaluation and match.evaluation.evaluatorName %}
*{{ match.evaluation.evaluatorName }}:*{% if match.evaluation.score != null %} {{ match.evaluation.score }}{% endif %}{% if match.evaluation.label %} ({{ match.evaluation.label }}){% endif %}{% endif %}`;

export const DEFAULT_SLACK_BLOCK_KIT_TEMPLATE = `[
  {
    "type": "header",
    "text": {
      "type": "plain_text",
      "text": "{% if trigger.alertType == 'INFO' %}ℹ️{% elsif trigger.alertType == 'WARNING' %}⚠️{% elsif trigger.alertType == 'CRITICAL' %}🔴{% else %}🔔{% endif %} {{ trigger.name }}",
      "emoji": true
    }
  },
  {% if trigger.alertType %}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": "*Alert type:* {{ trigger.alertType }}" }
    ]
  },
  {% endif %}
  {% if trigger.message %}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ trigger.message | json }} }
  },
  {% endif %}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ match.trace.input | truncate: 300 | prepend: "*Input:* " | json }} }
  },
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ match.trace.output | truncate: 300 | prepend: "*Output:* " | json }} }
  },
  {% if match.evaluation and match.evaluation.evaluatorName %}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ match.evaluation.evaluatorName | prepend: "*" | append: "*" | json }} }{% if match.evaluation.score != null %},
      { "type": "mrkdwn", "text": "score {{ match.evaluation.score }}" }{% endif %}{% if match.evaluation.label %},
      { "type": "mrkdwn", "text": {{ match.evaluation.label | json }} }{% endif %}
    ]
  },
  {% endif %}
  {
    "type": "divider"
  },
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": "<{{ match.trace.url }}|View trace> · <{{ trigger.editUrl }}|Edit automation>" }
    ]
  }
]`;

export const TEMPLATE_VARIABLES: VariableInfo[] = [
  {
    path: "trigger.id",
    type: "string",
    description: "Stable identifier of the automation.",
  },
  {
    path: "trigger.name",
    type: "string",
    description: "The automation's configured name.",
  },
  {
    path: "trigger.message",
    type: "string",
    description: "Optional free-form message stored on the automation.",
  },
  {
    path: "trigger.alertType",
    type: "'INFO' | 'WARNING' | 'CRITICAL' | null",
    description: "Severity label, or null if unset.",
  },
  {
    path: "trigger.editUrl",
    type: "string",
    description: "Deep link to this automation's edit page.",
  },
  {
    path: "project.name",
    type: "string",
    description: "Human-readable project name.",
  },
  {
    path: "project.slug",
    type: "string",
    description: "URL-safe project slug.",
  },
  {
    path: "project.url",
    type: "string",
    description: "Absolute URL to the project home.",
  },
  {
    path: "digest.count",
    type: "number",
    description: "1 for immediate cadence; N for a digest.",
  },
  {
    path: "digest.windowStart",
    type: "string | null",
    description: "ISO-8601 — only set for digest cadences.",
  },
  {
    path: "digest.windowEnd",
    type: "string | null",
    description: "ISO-8601 — only set for digest cadences.",
  },
  {
    path: "match.trace.id",
    type: "string | null",
    description: "Trace ID that matched the conditions.",
  },
  {
    path: "match.trace.input",
    type: "string",
    description: "Captured input of the matched trace.",
  },
  {
    path: "match.trace.output",
    type: "string",
    description: "Captured output of the matched trace.",
  },
  {
    path: "match.trace.url",
    type: "string",
    description: "Deep link to the matched trace.",
  },
  {
    path: "match.trace.metadata",
    type: "object",
    description: "Trace metadata as a key/value object.",
  },
  {
    path: "match.evaluation.score",
    type: "number | null",
    description: "Evaluation score, when the trigger is evaluation-bound.",
  },
  {
    path: "match.evaluation.passed",
    type: "boolean | null",
    description: "Evaluation passed/failed verdict.",
  },
  {
    path: "match.evaluation.label",
    type: "string | null",
    description: "Optional evaluation label.",
  },
  {
    path: "match.evaluation.evaluatorName",
    type: "string | null",
    description: "Display name of the evaluator that ran.",
  },
];

/** Notification cadence the variable surface is filtered for. Only "immediate"
 *  is live today; "digest" is reserved for ADR-025. */
export type TemplateCadence = "immediate" | "digest";

/** Filters the variable list down to what's *actually available* at the given
 *  cadence. Immediate fires expose `match.*` (singular) and `digest.count = 1`;
 *  `digest.windowStart` / `digest.windowEnd` are null and only meaningful in a
 *  digest payload, so we hide them so authors don't reach for variables that
 *  always render empty. Digest will later additionally expose `matches[]`. */
export function filterVariablesForCadence(
  variables: VariableInfo[],
  cadence: TemplateCadence,
): VariableInfo[] {
  if (cadence === "digest") return variables;
  return variables.filter(
    (v) => v.path !== "digest.windowStart" && v.path !== "digest.windowEnd",
  );
}

export interface ClientScaffold {
  defaults: {
    emailSubject: string;
    emailBody: string;
    slackString: string;
    slackBlockKit: string;
  };
  variables: VariableInfo[];
  /** Plain JSON shape mirroring the server's `TemplateContext`; rendered by
   *  the Example Data panel as pretty-printed JSON. */
  example: unknown;
}

/** Mirrors the server's `EXAMPLE_MATCHES[0]`. Drift-prevention test compares. */
function buildExampleMatch(baseHost: string, projectSlug: string) {
  return {
    trace: {
      id: "trace_2x9fK3aQ",
      input: "What is the capital of France?",
      output: "The capital of France is Paris.",
      url: `${baseHost}/${projectSlug}/messages/trace_2x9fK3aQ`,
      metadata: { customer_id: "cust_123", topic: "geography" },
    },
    evaluation: {
      score: 0.92,
      passed: true,
      label: "relevant",
      evaluatorName: "Answer Relevancy",
    },
  };
}

/** Builds the example `TemplateContext` the preview panel renders against,
 *  using a placeholder identity (so it works before the user has typed a
 *  name) and the actual project slug for plausible URLs. */
export function buildClientScaffold(project: {
  name: string;
  slug: string;
}): ClientScaffold {
  const baseHost = typeof window !== "undefined"
    ? window.location.origin
    : "https://app.langwatch.ai";
  const match = buildExampleMatch(baseHost, project.slug);
  const projectUrl = `${baseHost}/${project.slug}`;
  const example = {
    trigger: {
      id: "preview",
      name: "Your automation",
      message: "",
      alertType: null,
      editUrl: `${projectUrl}/automations?drawer.open=automation&drawer.automationId=preview&drawer.source=email-link`,
    },
    project: {
      name: project.name,
      slug: project.slug,
      url: projectUrl,
    },
    digest: { count: 1, windowStart: null, windowEnd: null },
    match,
    matches: [match],
  };
  return {
    defaults: {
      emailSubject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
      emailBody: DEFAULT_EMAIL_BODY_TEMPLATE,
      slackString: DEFAULT_SLACK_TEMPLATE,
      slackBlockKit: DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
    },
    variables: TEMPLATE_VARIABLES,
    example,
  };
}
