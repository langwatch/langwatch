# Traces v2 — Onboarding

Self-contained module for the empty-state experience and the Tour. The rest
of the codebase touches this through a tiny public API in `index.ts`; nothing
outside the module should import from any other file under here.

## What lives in here

The empty-state journey, the sample-data preview that backs it, the Tour
chapters (welcome → density → slice → arrivals → drawer → outroPanel), the
returning-user hub, the toolbar Tour entry point, and the various decorations
that fire while the journey is running (drawer/sidebar glow, body data
attribute, aurora ribbon).

## What does NOT live in here

- `useProjectHasTraces` — project-level fact, used by the toolbar's SDK
  re-entry button independently of onboarding. Stays at the traces-v2
  hooks level.
- `useTraceListQuery` — core trace fetching. Consumes the onboarding sample
  hook (`useSamplePreview`) but isn't itself onboarding-specific.
- General UI prefs (sidebar collapsed, syntax help, shortcuts dialog) —
  stay in `traces-v2/stores/uiStore.ts`.
- The What's-new dialog — being retired and absorbed into the Tour's
  outro panel; will be deleted from `welcomeStore.ts` once that lands.

## Public API

Imports from outside this module should only use what `index.ts` re-exports:

- `<OnboardingHost>` — single mount point. Wraps the page chrome and decides
  whether to render the overlay, banner, aurora, glow, body data attribute,
  etc. **Crucially: when onboarding is not active it renders children
  verbatim with zero DOM additions and zero side-effects.** No "mounted but
  hidden" components.
- `useOnboardingActive()` — boolean. "Is the onboarding overlay currently
  rendering?". For consumers (like TracesPage) that need to fork chrome
  behaviour.
- `useSamplePreview()` — returns `{ data, totalHits } | null`. The trace
  list query calls this once and uses the override if present. Single
  integration point for sample-data injection.
- `useTourEntryPoints()` — returns the actions the toolbar needs (launch
  Tour, resume from SDK-pending). One source of truth for both buttons.

Internal types (`StageId`, store slices, chapter definitions, etc.) stay
internal.

## Lazy-mount discipline

This module renders nothing when there's no onboarding to render. Every
decoration component (`DrawerGlow`, `SampleDataBanner`, `OnboardingAurora`,
`BodyStageAttribute`, `EmptyStateOverlay`) gates itself on the appropriate
condition. The host returns `{children}` directly in the inactive path.
No body attributes, no global `<style>` tags, no portal anchors get added
to the DOM for users who aren't seeing onboarding.

If you find yourself adding a `useEffect` that runs during the inactive
path, you've drifted — push it into a child component that only mounts
when active.

## Directory layout

```
onboarding/
├── index.ts                    # public API
├── OnboardingHost.tsx          # single mount point
├── components/                 # journey UI
│   ├── EmptyStateOverlay.tsx
│   ├── SampleDataBanner.tsx
│   ├── ReturningUserHub.tsx
│   ├── OutroPanel.tsx
│   ├── BeadStrip.tsx
│   ├── DensitySpotlight.tsx
│   ├── IntegrateDrawer.tsx
│   ├── TypewriterHero.tsx
│   └── primitives/
│       └── Hero.tsx
├── chapters/                   # one file per chapter
│   ├── welcome.ts
│   ├── density.ts
│   ├── slice.ts
│   ├── arrivals.ts
│   ├── drawer.ts
│   ├── outro.ts
│   └── chapters.ts             # order + types + helpers
├── effects/                    # global side-effects, all lazy-mounted
│   ├── DrawerGlow.tsx
│   ├── BodyStageAttribute.tsx
│   └── OnboardingAurora.tsx
├── store/
│   └── onboardingStore.ts      # stage state + setupDismissed +
│                               # tourActive + completion flags
├── hooks/
│   ├── useOnboardingActive.ts
│   ├── useSamplePreview.ts
│   ├── useTourEntryPoints.ts
│   └── useChapterNavigation.ts
└── data/
    └── samplePreviewTraces.ts  # fixture set for the Tour
```

## Migration status

This module is being migrated from the old `EmptyState/` location in
`src/features/traces-v2/components/EmptyState/`. The plan runs in
strictly sequenced steps so the codebase keeps compiling at every
checkpoint. See the parent design discussion (sections 14–15) for the
full story.

Done:
- [x] Step 1 — skeleton + this README
- [x] Step 2 — move `samplePreviewTraces.ts` to `data/`
- [x] Step 3 — consolidate stores (onboardingStageStore + onboarding fields
  from uiStore → `store/onboardingStore.ts`; journey config moved to
  `chapters/onboardingJourneyConfig.ts`)

In progress:
- [ ] Step 4 — extract hero sub-components
- [ ] Step 5 — build public-API hooks
- [ ] Step 6 — refactor `useTraceListQuery` to use `useSamplePreview`
- [ ] Step 7 — refactor `Toolbar` to use `useTourEntryPoints`
- [ ] Step 8 — build `OnboardingHost` and shrink `TracesPage`
- [ ] Step 9 — delete obsolete files (`welcomeStore`, `useAutoOpenWelcome`,
  `EmptyState/`)
- [ ] Step 10 — start adding the new chapter content (lens reveal, slice
  merge, outro panel, bead strip)
