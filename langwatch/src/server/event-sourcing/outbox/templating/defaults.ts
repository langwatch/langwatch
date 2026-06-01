/**
 * Framework default templates. A NULL template column on a Trigger means
 * "render with these". The email body intentionally does NOT carry the
 * "Sent with ♥ from LangWatch · Edit automation" line — that footer sits in
 * the email chrome (`emailLayout.ts`) so every email keeps it consistently,
 * regardless of what a customer template prints.
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

/**
 * Block Kit starter — a valid Block Kit JSON document with Liquid variables
 * inside string values. Authors edit this as JSON and Liquid renders before
 * `JSON.parse` in `renderSlack`, so variables expand into the final blocks.
 *
 * Uses unicode emoji (🔔 / ⚠️ / 🔴 / ℹ️) rather than `:bell:` shortcodes so the
 * preview pane renders the same way Slack will — the preview does not run
 * Slack's emoji shortcode substitution. Long input/output are truncated; the
 * footer context block carries the edit link.
 */
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
