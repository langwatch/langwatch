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

This automation fired against {% if matches.size == 1 %}a matching trace{% else %}{{ matches.size }} matching traces{% endif %}.
{% for m in matches %}{% if m.evaluation and m.evaluation.evaluatorName %}

**{{ m.evaluation.evaluatorName }}**{% if m.evaluation.score != null %} — score {{ m.evaluation.score }}{% endif %}{% if m.evaluation.label %} ({{ m.evaluation.label }}){% endif %}{% if m.evaluation.passed == false %} — **failed**{% endif %}
{% endif %}

**Input**
> {{ m.trace.input | truncate: 400 }}

**Output**
> {{ m.trace.output | truncate: 400 }}

[View matched trace ↗]({{ m.trace.url }})
{% endfor %}`;

export const DEFAULT_SLACK_TEMPLATE = `{% if trigger.alertType == 'INFO' %}ℹ️{% elsif trigger.alertType == 'WARNING' %}⚠️{% elsif trigger.alertType == 'CRITICAL' %}🔴{% else %}🔔{% endif %} *{{ trigger.name }}*{% if trigger.alertType %} _({{ trigger.alertType }})_{% endif %}
{% for m in matches %}*Input:* {{ m.trace.input | truncate: 200 }}
*Output:* {{ m.trace.output | truncate: 200 }}{% if m.evaluation and m.evaluation.evaluatorName %}
*{{ m.evaluation.evaluatorName }}:*{% if m.evaluation.score != null %} {{ m.evaluation.score }}{% endif %}{% if m.evaluation.label %} ({{ m.evaluation.label }}){% endif %}{% endif %}
<{{ m.trace.url }}|View trace>{% unless forloop.last %}
{% endunless %}{% endfor %}`;

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
    {%- capture _header_prefix -%}{% if trigger.alertType == 'INFO' %}ℹ️{% elsif trigger.alertType == 'WARNING' %}⚠️{% elsif trigger.alertType == 'CRITICAL' %}🔴{% else %}🔔{% endif %} {%- endcapture -%}
    "text": {
      "type": "plain_text",
      "text": {{ trigger.name | prepend: _header_prefix | json }},
      "emoji": true
    }
  },
  {% if trigger.alertType %}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ trigger.alertType | prepend: "*Alert type:* " | json }} }
    ]
  },
  {% endif %}
  {% for m in matches %}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ m.trace.input | truncate: 300 | prepend: "*Input:* " | json }} }
  },
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ m.trace.output | truncate: 300 | prepend: "*Output:* " | json }} }
  },
  {% if m.evaluation and m.evaluation.evaluatorName %}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ m.evaluation.evaluatorName | prepend: "*" | append: "*" | json }} }{% if m.evaluation.score != null %},
      { "type": "mrkdwn", "text": "score {{ m.evaluation.score }}" }{% endif %}{% if m.evaluation.label %},
      { "type": "mrkdwn", "text": {{ m.evaluation.label | json }} }{% endif %}
    ]
  },
  {% endif %}
  {%- capture _trace_link -%}<{{ m.trace.url }}|View trace>{%- endcapture -%}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ _trace_link | json }} }
    ]
  },
  {% endfor %}
  {
    "type": "divider"
  },
  {%- capture _footer_text -%}<{{ trigger.editUrl }}|Edit automation>{%- endcapture -%}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ _footer_text | json }} }
    ]
  }
]`;
