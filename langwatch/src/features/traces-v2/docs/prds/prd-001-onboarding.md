# PRD-001: Onboarding Empty State

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The state users see inside the Traces view when no trace data exists for their project. Not a product onboarding flow — the user has already signed up and navigated here. This is a contextual empty state that helps them send their first trace.

## Layout

Renders inside the main content area (replacing the trace table). The filter column and nav are still visible but inactive.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [LangWatch]  Observe  Live Tail                                     │
├──────────────────────────────────────────────────────────────────────┤
│ [@search...]                                                        │
├────────────┬────────────────────────────────────────────────────────-┤
│  FILTERS   │                                                        │
│  (empty/   │          ┌─────────────────────────────┐               │
│   greyed   │          │                             │               │
│   out)     │          │      No traces yet          │               │
│            │          │                             │               │
│            │          │  Traces show you what your  │               │
│            │          │  AI agents are doing: every │               │
│            │          │  LLM call, tool use, and    │               │
│            │          │  decision they make.        │               │
│            │          │                             │               │
│            │          │  ┌─────────┐ ┌───────────┐ │               │
│            │          │  │  With   │ │  Manual   │ │               │
│            │          │  │ Skills  │ │Integration│ │               │
│            │          │  └─────────┘ └───────────┘ │               │
│            │          │                             │               │
│            │          │  ── or ──                   │               │
│            │          │                             │               │
│            │          │  [Explore with sample data] │               │
│            │          │                             │               │
│            │          └─────────────────────────────┘               │
│            │                                                        │
└────────────┴────────────────────────────────────────────────────────┘
```

## Content

### Heading
"No traces yet"

### Description
1-2 sentences: "Traces show you what your AI agents are doing: every LLM call, tool use, and decision they make."

### Setup Path 1: Skills (recommended, left card)
Title: "Set up with Skills"
Steps:
1. Create an API key → link to project settings
2. Set environment variables:
   ```
   LANGWATCH_API_KEY=your-key
   LANGWATCH_ENDPOINT=https://...
   ```
3. Run the setup skill in Claude Code (or similar)

The card should feel like a quick-start: 3 steps, done. Emphasize that this is the easiest path.

### Setup Path 2: Manual Integration (right card)
Title: "Manual integration"
Links to existing integration docs. Shows supported frameworks/SDKs (Python, TypeScript, LangChain, etc.) as small logos or text badges. Clicking opens the existing integration UI/docs.

### Demo Data CTA
Below both cards, separated by a divider ("or").
Button: "Explore with sample data"
Clicking this populates the trace table with ~20 realistic mock traces so the user can experience the UI before integrating. Demo data is loaded client-side from a static fixture, not from the API.

## Behavior

- Renders when the trace count for the current project is zero
- Filter column is visible but greyed out / empty (no data to filter)
- Search bar is visible but disabled
- Nav shows Observe (active) and Live Tail (clickable but shows its own empty state if no data)
- When demo data is loaded, the empty state disappears and the full trace table renders with the sample data. A banner at the top says "Viewing sample data" with a dismiss/clear button.

### First Real Data Celebration
When the first real traces arrive (project goes from 0 to >0 real traces):
- Brief confetti burst animation (CSS particles, ~2 seconds)
- Banner: "Your first traces are arriving!" with a tada emoji
- Auto-dismisses after 10 seconds, or dismiss manually
- Only triggers once per project (flag stored in user preferences)
- If the user was viewing demo data, the banner switches to "Real data is flowing! Switching from sample data..." and the demo data is replaced.

## Design Notes

- Centered vertically and horizontally in the content area
- Clean, minimal — no illustrations or complex graphics
- The two setup cards should be equal weight, side by side
- Match the product's existing design language (Chakra UI components)
- The demo data button is secondary/tertiary styling, not competing with the setup paths
