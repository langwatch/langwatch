# PRD-010: Prompt Integration

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

A dedicated accordion section in the span tab (PRD-006) for LLM spans that used a managed LangWatch prompt. Shows prompt metadata, version info, template variables, and provides contextual actions like opening in the playground or comparing versions.

This section only appears when we detect that a span used a managed prompt. It does NOT appear for ad-hoc LLM calls that don't use prompt management.

## When This Shows

- Span tab is active (user clicked a span in the viz)
- The selected span is an LLM span (detected from data, not span type label)
- The span has prompt metadata in its attributes (see Detection below)

If the span has no prompt metadata, this accordion section is hidden entirely — not shown empty.

## Detection

A span used a managed prompt if ANY of these attributes exist:

- `langwatch.prompt.name` — the prompt template name
- `langwatch.prompt.version` — the version used
- `langwatch.prompt.id` — the prompt ID in LangWatch

The presence of any of these triggers the Prompt accordion. The renderer does NOT check the span type — it checks the attributes.

## Layout

The Prompt accordion appears in the span tab between I/O and Attributes:

```
┌──────────────────────────────────────────────────────────┐
│  ┌──────────────┐ ┌──────────────────────────────────┐   │
│  │ Trace Summary│ │ llm.openai.chat  LLM  1.1s  ×   │   │
│  ╘══════════════╛ ╘══════════════════════════════════╧═══╡
│  ▼ I/O                                                   │
│  ▼ Prompt                                                │
│  ▶ Attributes                                            │
└──────────────────────────────────────────────────────────┘
```

**Accordion order in span tab:** I/O → Prompt → Attributes

## Prompt Accordion Content

```
┌──────────────────────────────────────────────────────────┐
│  ▼ Prompt                                                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  refund-policy-agent           v1.4       ● active       │
│                                                          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                          │
│  TEMPLATE                                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ You are a customer support agent for {{company}}.  │  │
│  │ Answer questions about {{topic}} using the          │  │
│  │ following context:                                  │  │
│  │ {{context}}                                         │  │
│  │                                                     │  │
│  │ Rules:                                              │  │
│  │ - Be concise and accurate                           │  │
│  │ - If unsure, say "I don't know"                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  VARIABLES                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │ company      "Acme Corp"                      [📋]│  │
│  │ topic        "refund policy"                  [📋]│  │
│  │ context      "For orders over $500, our ref..." [📋]│  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│  [Open in Playground →]  [Compare Versions]  [Edit →]   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Header

- **Prompt name:** The template name (e.g., `refund-policy-agent`). Monospace, bold.
- **Version:** The version used (e.g., `v1.4`). Monospace.
- **Active indicator:** If this version is the currently active version: `● active` (green dot). If not: `● v1.6 active` (yellow dot, showing which version IS active). See Version Mismatch below.

### Template

The full prompt template as written, with variable placeholders highlighted:

- Template text rendered in a monospace code block
- Variable placeholders (`{{company}}`, `{{topic}}`, `{{context}}`) highlighted with a subtle background color (e.g., `rgba(66, 153, 225, 0.15)`) to distinguish them from static text
- If the template is long (>500 chars), show first ~300 chars with "Show full template" expander
- Copy button for the full template

### Variables

The values that were filled into the template for this specific span:

- Key-value table: variable name → value
- Copy button per value
- Long values truncated with "Show full" expander
- Sorted alphabetically by variable name

### Version Mismatch Warning

If the span used a prompt version that is NOT the currently active version:

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ This span used v1.4 but v1.6 is active               │
│  Changes in v1.6: "Updated refund window from 30 to..."  │
│  [View diff between v1.4 and v1.6]                       │
└──────────────────────────────────────────────────────────┘
```

- Yellow warning banner at the top of the Prompt accordion
- Shows which version is active
- If version notes/changelog exist, show a one-line summary
- Link to view the diff between the two versions (opens in existing LangWatch prompt comparison UI)

This warning also appears as a contextual alert in the drawer (PRD-004) at the trace level:
`"⚠ Span used prompt v1.4 but v1.6 is active"`

### Actions

Three action buttons at the bottom of the accordion:

**[Open in Playground →]**
- Opens the LangWatch prompt playground pre-filled with:
  - This span's prompt template
  - This span's variable values
  - This span's model and parameters (temperature, max_tokens, etc.)
  - This span's input messages
- Opens in a new tab/context (not inside the drawer)
- The user can then tweak the prompt and re-run it

**[Compare Versions]**
- Opens a side-by-side comparison of two prompt versions
- Default: this span's version vs. the currently active version
- If they're the same version, this button is hidden
- Opens in existing LangWatch prompt comparison UI

**[Edit →]**
- Opens the prompt editor for this template in LangWatch
- Opens in a new tab/context
- The user can edit the template, variables, model settings

## Auto-Open Rules

| Context | Prompt accordion |
|---|---|
| Span with managed prompt, no version mismatch | Closed |
| Span with managed prompt, version mismatch | **Open** (the mismatch is important to see) |
| Span without managed prompt | Hidden (not shown at all) |

## Span Tab Accordion Order (updated)

When a span has prompt metadata, the accordion order is:

**I/O → Prompt → Attributes**

When a span does NOT have prompt metadata:

**I/O → Attributes** (same as before, Prompt accordion hidden)

## Prompt Data Sources

The prompt metadata comes from span attributes set by the LangWatch SDK when a managed prompt is used:

| Attribute | Content |
|---|---|
| `langwatch.prompt.id` | Prompt ID in LangWatch |
| `langwatch.prompt.name` | Human-readable template name |
| `langwatch.prompt.version` | Version string (e.g., "1.4") |
| `langwatch.prompt.template` | The full template text with `{{variable}}` placeholders |
| `langwatch.prompt.variables` | JSON object of variable name → value |

The active version and version notes are fetched from the LangWatch API (not from span attributes). This is the one part of this accordion that requires an API call — everything else is from the span data.

## Data Gating

- **No prompt attributes on span:** Accordion hidden entirely. No "No prompt data" empty state.
- **Prompt name exists but no template:** Show header (name, version) + variables (if available) + actions. Template section shows "Template not captured."
- **No variables:** Variables section hidden.
- **Version check fails (API error):** Show prompt data without the active indicator. Tooltip: "Could not check active version."
- **Prompt playground not available:** Hide [Open in Playground] button.
