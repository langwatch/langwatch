/**
 * Framework default templates. A NULL template column on a Trigger means
 * "render with these". The email body intentionally does NOT carry the
 * "Sent with ♥ from LangWatch · Edit automation" line — that footer sits in
 * the email chrome (`emailLayout.ts`) so every email keeps it consistently,
 * regardless of what a customer template prints.
 *
 * ADR-034 Phase 5: a SECOND default family targets custom-graph threshold
 * ALERTS (`alertDefaults` below). The shape of an alert is "metric X
 * crossed threshold Y" — not "this trace happened matching filters" —
 * so the default subject + body + Slack mrkdwn all read in metric-
 * crossed-threshold terms instead of trace terms. Callers pick the set
 * directly — graph-alert dispatch passes `ALERT_TRIGGER_DEFAULTS` as the
 * `defaults` override on `renderTriggerEmail` / `renderTriggerSlack`,
 * trace dispatch relies on the renderers' built-in trace defaults —
 * and per-trigger custom Liquid still overrides whichever default applies.
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
/**
 * ADR-034 Phase 5/8.1: alert-default templates for custom-graph threshold
 * alerts. Render in metric-crossed-threshold language against
 * `GraphAlertTemplateContext` — `trigger`, `graph`, `metric`,
 * `condition`, `currentValue`, `occurredAt`, `reason`, `project`.
 *
 * Phase 8.1 wires the graph-trigger evaluator through the same Liquid
 * pipeline trace triggers use, so these defaults must read those
 * fields directly instead of the trace-iteration shape Phase 5 used as
 * a placeholder. Graph-alert dispatch passes `ALERT_TRIGGER_DEFAULTS`
 * explicitly as the renderers' `defaults`; per-trigger custom Liquid
 * (the four Trigger columns) still overrides it.
 */
export const DEFAULT_ALERT_EMAIL_SUBJECT_TEMPLATE =
  "[Alert] {{ trigger.name }} — {{ metric.label }} {{ condition.operatorLabel }} {{ condition.threshold }}";

export const DEFAULT_ALERT_EMAIL_BODY_TEMPLATE = `# [Alert] {{ trigger.name }}

**{{ metric.label }}** {{ condition.operatorLabel }} **{{ condition.threshold }}** over the {{ condition.timePeriodLabel }}.
{% if reason == "heartbeat-absence" %}
No qualifying data was seen in the window.
{% endif %}
Current value: **{{ currentValue }}**{% if previousValue != nil %} (was {{ previousValue }}){% endif %} — threshold: {{ condition.operatorLabel }} {{ condition.threshold }}.
{% if sparkline != "" %}
Trend: \`{{ sparkline }}\`
{% endif %}
[Open dashboard ↗]({{ graph.url }})`;

export const DEFAULT_ALERT_SLACK_TEMPLATE = `:rotating_light: *{{ trigger.name | mrkdwn_escape }}*{% if trigger.alertType %} _({{ trigger.alertType }})_{% endif %}
*{{ metric.label | mrkdwn_escape }}* {{ condition.operatorLabel }} *{{ condition.threshold }}* over the {{ condition.timePeriodLabel }}.{% if reason == "heartbeat-absence" %}
No qualifying data was seen in the window.{% endif %}
Current value: *{{ currentValue }}*{% if previousValue != nil %} (was {{ previousValue }}){% endif %} — threshold: {{ condition.operatorLabel }} {{ condition.threshold }}.{% if sparkline != "" %}
Trend: \`{{ sparkline }}\`{% endif %}
<{{ graph.url }}|Open dashboard>`;

export const DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE = `[
  {
    "type": "header",
    "text": {
      "type": "plain_text",
      "text": {{ trigger.name | prepend: ":rotating_light: " | json }},
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
  {%- capture _metric_line -%}*{{ metric.label | mrkdwn_escape }}* {{ condition.operatorLabel }} *{{ condition.threshold }}* over the {{ condition.timePeriodLabel }}.{%- endcapture -%}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ _metric_line | json }} }
  },
  {%- capture _value_line -%}Current value: *{{ currentValue }}*{% if previousValue != nil %} (was {{ previousValue }}){% endif %} — threshold: {{ condition.operatorLabel }} {{ condition.threshold }}.{%- endcapture -%}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ _value_line | json }} }
  },
  {% if sparkline != "" %}
  {%- capture _trend_line -%}Trend: \`{{ sparkline }}\`{%- endcapture -%}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ _trend_line | json }} }
    ]
  },
  {% endif %}
  {%- capture _link -%}<{{ graph.url }}|Open dashboard>{%- endcapture -%}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ _link | json }} }
    ]
  },
  {
    "type": "divider"
  },
  {%- capture _footer_text -%}<{{ trigger.editUrl }}|Edit alert>{%- endcapture -%}
  {
    "type": "context",
    "elements": [
      { "type": "mrkdwn", "text": {{ _footer_text | json }} }
    ]
  }
]`;

/**
 * ADR-040: default Liquid JSON bodies for the Webhook channel — a stable,
 * documented envelope so a receiver can integrate without authoring a
 * template. Every interpolated value goes through `| json` so trace content
 * containing `"` or `}` cannot break out of the JSON structure (the JSON
 * analog of `mrkdwn_escape`). Optional values are guarded with `{% if %}`
 * rather than piped as nil, so the output always parses.
 */
export const DEFAULT_WEBHOOK_BODY_TEMPLATE = `{
  "event": "trigger.matched",
  "trigger": { "id": {{ trigger.id | json }}, "name": {{ trigger.name | json }}{% if trigger.alertType %}, "alertType": {{ trigger.alertType | json }}{% endif %} },
  "project": { "name": {{ project.name | json }}, "slug": {{ project.slug | json }} },
  "digest": { "count": {{ digest.count | json }} },
  "matches": [{% for m in matches %}
    { "traceId": {{ m.trace.id | json }}, "url": {{ m.trace.url | json }},
      "input": {{ m.trace.input | json }}, "output": {{ m.trace.output | json }} }{% unless forloop.last %},{% endunless %}{% endfor %}
  ]
}`;

export const DEFAULT_ALERT_WEBHOOK_BODY_TEMPLATE = `{
  "event": "alert.fired",
  "trigger": { "id": {{ trigger.id | json }}, "name": {{ trigger.name | json }}{% if trigger.alertType %}, "alertType": {{ trigger.alertType | json }}{% endif %} },
  "project": { "name": {{ project.name | json }}, "slug": {{ project.slug | json }} },
  "graph": { "name": {{ graph.name | json }}, "url": {{ graph.url | json }} },
  "metric": { "label": {{ metric.label | json }} },
  "condition": { "operator": {{ condition.operatorLabel | json }}, "threshold": {{ condition.threshold | json }}, "window": {{ condition.timePeriodLabel | json }} },
  "currentValue": {{ currentValue | json }}{% if previousValue != nil %},
  "previousValue": {{ previousValue | json }}{% endif %}
}`;

export const DEFAULT_REPORT_WEBHOOK_BODY_TEMPLATE = `{
  "event": "report.scheduled",
  "trigger": { "id": {{ trigger.id | json }}, "name": {{ trigger.name | json }} },
  "project": { "name": {{ project.name | json }}, "slug": {{ project.slug | json }} },
  "report": { "source": {{ report.sourceLabel | json }}, "schedule": {{ report.scheduleLabel | json }}, "isEmpty": {{ report.isEmpty | json }} },
  "traces": [{% for t in traces %}
    { "traceId": {{ t.traceId | json }}, "url": {{ t.url | json }}, "input": {{ t.input | json }} }{% unless forloop.last %},{% endunless %}{% endfor %}
  ],
  "charts": [{% for chart in charts %}
    { "title": {{ chart.title | json }}{% unless chart.isEmpty %}, "total": {{ chart.total | json }}{% endunless %} }{% unless forloop.last %},{% endunless %}{% endfor %}
  ],
  "viewUrl": {{ viewUrl | json }}
}`;

/**
 * The default-template strings a renderer needs, grouped together
 * to keep email + slack + webhook defaults aligned. Callers select the set
 * that matches the trigger directly — `ALERT_TRIGGER_DEFAULTS` for
 * custom-graph threshold alerts, `TRACE_TRIGGER_DEFAULTS` for trace triggers.
 */
export interface TriggerTemplateDefaults {
  emailSubject: string;
  emailBody: string;
  slackString: string;
  slackBlockKit: string;
  webhookBody: string;
}

export const ALERT_TRIGGER_DEFAULTS: TriggerTemplateDefaults = {
  emailSubject: DEFAULT_ALERT_EMAIL_SUBJECT_TEMPLATE,
  emailBody: DEFAULT_ALERT_EMAIL_BODY_TEMPLATE,
  slackString: DEFAULT_ALERT_SLACK_TEMPLATE,
  slackBlockKit: DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE,
  webhookBody: DEFAULT_ALERT_WEBHOOK_BODY_TEMPLATE,
};

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

export const TRACE_TRIGGER_DEFAULTS: TriggerTemplateDefaults = {
  emailSubject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  emailBody: DEFAULT_EMAIL_BODY_TEMPLATE,
  slackString: DEFAULT_SLACK_TEMPLATE,
  slackBlockKit: DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  webhookBody: DEFAULT_WEBHOOK_BODY_TEMPLATE,
};


/**
 * ADR-044: default templates for a SCHEDULED REPORT. Reads as "here is your
 * {source} for {period}" — `report.sourceLabel`, `report.scheduleLabel`,
 * `viewUrl`, plus the report's data: `traces` for a trace-query report,
 * `charts` for a graph or dashboard one. Rendered through the same Liquid
 * pipeline; per-trigger custom templates still override.
 *
 * These are the FALLBACK, so they must say something useful for any source —
 * hence both branches. The gallery layouts (`templates/report_*.liquid`) are
 * what a report normally renders with, and those are source-specific.
 */
export const DEFAULT_REPORT_EMAIL_SUBJECT_TEMPLATE =
  "[Report] {{ trigger.name }} — {{ report.scheduleLabel }}";

export const DEFAULT_REPORT_EMAIL_BODY_TEMPLATE = `# {{ trigger.name }}

{{ report.sourceLabel }} · {{ report.scheduleLabel }}.
{% if report.isEmpty %}
Nothing to show for this period.
{% else %}{% for t in traces %}- [{{ t.traceId }}]({{ t.url }}) — {{ t.input }} _({{ t.model }} · \${{ t.costUsd | round: 4 }} · {{ t.durationMs | round: 0 }} ms)_
{% endfor %}{% for chart in charts %}- **{{ chart.title }}** — {% if chart.isEmpty %}no data{% else %}{{ chart.total | round: 2 }}{% endif %}
{% endfor %}{% endif %}
[View in LangWatch ↗]({{ viewUrl }})`;

/**
 * How many rows the default Slack report message lists inline. A report can
 * match up to 100 traces, and Slack rejects a `section` whose text runs past
 * 3000 characters — with a non-retryable `invalid_blocks`, so an over-long
 * message is not delivered at all. The default therefore lists the first rows
 * and tells the reader how many more there are; the full set is one click away
 * in LangWatch.
 */
const REPORT_SLACK_ROW_LIMIT = 10;

export const DEFAULT_REPORT_SLACK_TEMPLATE = `:bar_chart: *{{ trigger.name | mrkdwn_escape }}*
{{ report.sourceLabel | mrkdwn_escape }} · {{ report.scheduleLabel }}{% if report.isEmpty %}
_Nothing to show for this period._{% else %}
{% for t in traces limit: ${REPORT_SLACK_ROW_LIMIT} %}• <{{ t.url }}|{{ t.traceId }}> {{ t.input | mrkdwn_escape }}
{% endfor %}{% if traces.size > ${REPORT_SLACK_ROW_LIMIT} %}_…and {{ traces.size | minus: ${REPORT_SLACK_ROW_LIMIT} }} more_
{% endif %}{% for chart in charts limit: ${REPORT_SLACK_ROW_LIMIT} %}• *{{ chart.title | mrkdwn_escape }}* — {% if chart.isEmpty %}_no data_{% else %}{{ chart.total | round: 2 }}{% endif %}
{% endfor %}{% if charts.size > ${REPORT_SLACK_ROW_LIMIT} %}_…and {{ charts.size | minus: ${REPORT_SLACK_ROW_LIMIT} }} more_
{% endif %}{% endif %}
<{{ viewUrl }}|View in LangWatch>`;

export const DEFAULT_REPORT_SLACK_BLOCK_KIT_TEMPLATE = `[
  {
    "type": "header",
    "text": { "type": "plain_text", "text": {{ trigger.name | prepend: ":bar_chart: " | json }}, "emoji": true }
  },
  {%- capture _sub -%}{{ report.sourceLabel }} · {{ report.scheduleLabel }}{%- endcapture -%}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ _sub | json }} }
  },
  {%- if report.isEmpty -%}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": "_Nothing to show for this period._" }
  },
  {%- else -%}
  {%- capture _rows -%}{% for t in traces limit: ${REPORT_SLACK_ROW_LIMIT} %}• <{{ t.url }}|{{ t.traceId }}> {{ t.input | mrkdwn_escape }}
{% endfor %}{% if traces.size > ${REPORT_SLACK_ROW_LIMIT} %}_…and {{ traces.size | minus: ${REPORT_SLACK_ROW_LIMIT} }} more_
{% endif %}{% for chart in charts limit: ${REPORT_SLACK_ROW_LIMIT} %}• *{{ chart.title | mrkdwn_escape }}* — {% if chart.isEmpty %}_no data_{% else %}{{ chart.total | round: 2 }}{% endif %}
{% endfor %}{% if charts.size > ${REPORT_SLACK_ROW_LIMIT} %}_…and {{ charts.size | minus: ${REPORT_SLACK_ROW_LIMIT} }} more_
{% endif %}{%- endcapture -%}
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": {{ _rows | json }} }
  },
  {%- endif -%}
  {
    "type": "context",
    "elements": [{ "type": "mrkdwn", "text": {{ viewUrl | prepend: "<" | append: "|View in LangWatch>" | json }} }]
  }
]`;

export const REPORT_TRIGGER_DEFAULTS: TriggerTemplateDefaults = {
  emailSubject: DEFAULT_REPORT_EMAIL_SUBJECT_TEMPLATE,
  emailBody: DEFAULT_REPORT_EMAIL_BODY_TEMPLATE,
  slackString: DEFAULT_REPORT_SLACK_TEMPLATE,
  slackBlockKit: DEFAULT_REPORT_SLACK_BLOCK_KIT_TEMPLATE,
  webhookBody: DEFAULT_REPORT_WEBHOOK_BODY_TEMPLATE,
};

/** What a trigger is about — trace data, a custom-graph threshold alert, or a
 *  scheduled report. Each renders against its own variable contract, so each
 *  has its own default template set. */
export type TemplateSourceKind = "trace" | "graphAlert" | "report";

/**
 * The single answer to "which default templates apply to this source kind".
 * Every surface that seeds, previews, or dispatches a template asks here — the
 * editor an author types into, the preview beside it, and the message that is
 * actually sent must all resolve the same set, or the author is shown a
 * template that will never be sent.
 */
export function defaultsForSourceKind(
  sourceKind: TemplateSourceKind,
): TriggerTemplateDefaults {
  switch (sourceKind) {
    case "graphAlert":
      return ALERT_TRIGGER_DEFAULTS;
    case "report":
      return REPORT_TRIGGER_DEFAULTS;
    case "trace":
      return TRACE_TRIGGER_DEFAULTS;
  }
}
