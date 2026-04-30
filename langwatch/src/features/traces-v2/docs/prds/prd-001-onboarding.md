# PRD-001: Onboarding Empty State

Parent: [Design: Trace v2](../trace-v2.md)
Status: IMPLEMENTED (revised 2026-04-28)
Date: 2026-04-22 (original) · 2026-04-28 (revision)

## What This Is

The state users see inside the Traces view when no trace data exists for their project. Not a product onboarding flow — the user has already signed up and navigated here. This is a contextual empty state that helps them send their first trace.

## Layout (revised 2026-04-28)

Renders inside the main content area (replacing the trace table) via `TracesEmptyOnboarding`. Filter sidebar and toolbar are still visible but inert until traces exist.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Send your first trace                                               │
│  Generate an access token, then pick a setup style.                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  PatIntegrationInfoCard                                        │ │
│  │  • mints a Personal Access Token inline                        │ │
│  │  • shows env block (LANGWATCH_API_KEY + X-Project-Id)  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Want to look around first?     [▶ Seed sample traces]         │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  [ Via Coding Agent | Via MCP | Manually ]                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Active tab body — lifted from main onboarding flow:           │ │
│  │   • Coding Agent → ViaClaudeCodeScreen (showMcpTab=false)      │ │
│  │   • MCP          → ViaMcpClientScreen                          │ │
│  │   • Manually     → PlatformGrid + FrameworkGrid + InstallPreview│ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

The three setup-path tabs render blurred + non-interactive until a PAT has been minted, so the PAT card is the only call-to-action while locked.

## Content

### Heading
"Send your first trace"

### Description
"Generate an access token, then pick a setup style. Traces will start appearing here once your app sends them."

### Step 1: PAT Minting (always visible)
`PatIntegrationInfoCard` mints a Personal Access Token in-place and surfaces:
- the freshly minted token (one-time view + copy)
- env block with `LANGWATCH_API_KEY` and `X-Project-Id`

The token is propagated to every tab through `ActiveProjectProvider`, which overrides the project's `apiKey` so the lifted onboarding screens render with the new credential without needing to be modified.

### Sample Data CTA (visible after PAT)
A subtle row appears under the PAT card once a token exists: "Want to look around first? [Seed sample traces]". Clicking writes a batch of synthetic traces into the project via `useSampleData` (server-side, real ingestion) and pre-seeds the filter to `origin:sample`. The page then strips `?empty` from the URL so the user lands on the live table.

### Setup Paths (tabs, blurred until PAT exists)

1. **Via Coding Agent** — `ViaClaudeCodeScreen` lifted from main onboarding (sub-tabs: Prompts, Skills; MCP sub-tab is hidden because MCP has its own top-level tab here).
2. **Via MCP** — `ViaMcpClientScreen` lifted from main onboarding (Claude Desktop, ChatGPT, etc.).
3. **Manually** — `PlatformGrid` + `FrameworkGrid` + `InstallPreview` + `FrameworkIntegrationCode` for direct SDK integration.

Each segment carries a one-liner description above the body explaining what it's for.

## Behavior

- Renders when the project has zero traces, gated by `useProjectHasTraces` so it does not flash during refreshes (see `freshnessSignal` / `MIN_REFRESH_VISIBLE_MS`).
- Filter sidebar and toolbar render but cannot fetch — sample data load is the only path that brings the table to life from this state.
- When sample data is loaded, the empty state disappears and the trace table renders with the sample traces. A `DemoModeBanner` at the top says "Viewing sample data" with a dismiss/clear control.

### First Real Data Celebration
`CelebrationBanner` triggers when the first real traces arrive (project goes from 0 → >0 real traces):
- Brief confetti burst (CSS particles, ~2 seconds)
- Banner: "Your first traces are arriving!" with a tada emoji
- Auto-dismisses after 10 seconds, or dismiss manually
- Only triggers once per project (flag stored in user preferences)
- If sample data was active, the banner switches to "Real data is flowing! Switching from sample data..." and the demo data is replaced.

## Design Notes

- Centered horizontally with a `1200px` max-width column (`paddingX={{ base: 4, md: 8 }}`).
- Tabs use Chakra `Tabs.Root` with `variant="line" colorPalette="orange"`.
- The sample-data row uses `bg.subtle` and is purely secondary — never competes with the PAT card.
- All copy stays terse. No illustrations.

## Implementation Pointers
- `components/EmptyState/TracesEmptyOnboarding.tsx`
- `components/EmptyState/PatIntegrationInfoCard.tsx`
- `components/EmptyState/useSampleData.ts`
- `components/EmptyState/DemoModeBanner.tsx`
- `components/EmptyState/CelebrationBanner.tsx`
- `hooks/useProjectHasTraces.ts`
