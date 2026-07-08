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

/**
 * User-controlled trace content (`m.trace.input` / `m.trace.output`) and
 * evaluation labels flow into Slack mrkdwn, where `&`, `<`, `>` are control
 * characters. We pass them through `| mrkdwn_escape` (registered in `engine.ts`)
 * before any literal formatting so authored content can't forge mrkdwn links
 * (`<https://evil|click>`) or broadcasts (`<!channel>`) — the Slack-mrkdwn-
 * injection finding. `trigger.name` / `evaluatorName` are operator-controlled
 * and left unescaped. Truncation runs first so the budget counts visible
 * characters and never splits an `&amp;`/`&lt;`/`&gt;` entity.
 */
export const DEFAULT_SLACK_TEMPLATE = `{% if trigger.alertType == 'INFO' %}ℹ️{% elsif trigger.alertType == 'WARNING' %}⚠️{% elsif trigger.alertType == 'CRITICAL' %}🔴{% else %}🔔{% endif %} *{{ trigger.name }}*{% if trigger.alertType %} _({{ trigger.alertType }})_{% endif %}
{% for m in matches %}*Input:* {{ m.trace.input | truncate: 200 | mrkdwn_escape }}
*Output:* {{ m.trace.output | truncate: 200 | mrkdwn_escape }}{% if m.evaluation and m.evaluation.evaluatorName %}
*{{ m.evaluation.evaluatorName }}:*{% if m.evaluation.score != null %} {{ m.evaluation.score }}{% endif %}{% if m.evaluation.label %} ({{ m.evaluation.label | mrkdwn_escape }}){% endif %}{% endif %}
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
 *
 * User-controlled fields (`m.trace.input` / `m.trace.output`, evaluation label)
 * land in `mrkdwn`-typed text objects, so they pass through `| mrkdwn_escape`
 * before `| json` — see the Slack-mrkdwn-injection finding and the
 * DEFAULT_SLACK_TEMPLATE comment above.
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
    "text": { "type": "mrkdwn", "text": {{ m.trace.input | truncate: 300 | mrkdwn_escape | prepend: "*Input:* " | json }} }
  },
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ m.trace.output | truncate: 300 | mrkdwn_escape | prepend: "*Output:* " | json }} }
  },
  {% if m.evaluation and m.evaluation.evaluatorName %}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ m.evaluation.evaluatorName | prepend: "*" | append: "*" | json }} }{% if m.evaluation.score != null %},
      { "type": "mrkdwn", "text": "score {{ m.evaluation.score }}" }{% endif %}{% if m.evaluation.label %},
      { "type": "mrkdwn", "text": {{ m.evaluation.label | mrkdwn_escape | json }} }{% endif %}
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
