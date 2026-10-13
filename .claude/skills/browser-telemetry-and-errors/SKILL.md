---
name: browser-telemetry-and-errors
description: "What the small browser support packages are for and when feature code uses them: packages/react-rum (browser traces, error spans, navigation spans; the host starts it, features do not), packages/error-views (HandledErrorState, HandledErrorAlert, FormServerError, AggregateReadOnlyGate, resolveErrorCopy), the error presentation registry (now @langwatch/handled-error/presentation; packages/error-presentation is a deleted spelling), @langwatch/browser-host/errors (showErrorToast, applyHandledErrorToForm), and packages/design-system-internal (the paper look of internal consoles, not the product). Use when someone says 'show an error', 'toast the error', 'error.message', 'HandledError in the UI', 'form server error', 'field errors from the server', 'error page', 'RUM', 'browser tracing', 'browser.error span', 'react-rum', 'error-views', 'error-presentation', 'readHandledError', 'design-system-internal', 'console UI', 'haven hub styling', or 'aggregate read-only notice'."
user-invocable: true
---

# Browser telemetry and errors

Record: `dev/docs/ARCHITECTURE.md` section 10.2 (browser telemetry, the paragraph "Browser telemetry"), section 12 (errors),
section 15 and 16 (deleted and renamed names). The component choice and tokens are the `design-system` skill; where a
browser file goes is `browser-module`. This page is the four support packages and the one rule that ties the errors
together: **a screen renders a failure from the code-keyed registry, never from `error.message`.**

## packages/react-rum: the host's, not yours

`@langwatch/react-rum` correlates browser traces with backend traces (ADR 058, `dev/docs/adr/058-full-stack-trace-correlation-browser-rum.md`).
It exports `startBrowserTracing`, `startBrowserErrorCapture`, `startNavigationSpan`, `NavigationContextManager`, the session
helpers and the constants (`RUM_DEFAULT_SAMPLE_RATIO`, `RUM_TRACES_PATH`, `RUM_SESSION_HEADER`).

- It is on by default wherever a collector is configured. Console errors, uncaught errors and rejected promises leave as
  `browser.error` spans through our RUM endpoint, which forwards them to the collector over OTLP and to PostHog when PostHog is configured.
- Only `@langwatch/browser-host` depends on it: `packages/browser-host/src/telemetry/browser-tracing.ts`
  (`useBrowserTracing`, fed resolved public config) and `navigation-tracing.ts` (one span per navigation).
- **Feature code never imports it.** A module's browser does not start tracing, create a provider or add its own error
  listener; the shell already does. Throwing or rejecting is how a failure reaches RUM. Error text is sanitised and capped in
  the package (`sanitiseErrorMessage`, `BROWSER_ERROR_MAX_LENGTH`), so do not worry about leaking a URL query; do put nothing
  secret in a message anyway.
- Change it only when the task is the telemetry itself (sampling, a new span). It is a framework package.

## The registry and `readHandledError`

A server failure arrives as a `HandledError` with a stable code. The customer copy, title, tips and docs link for each code
live in `packages/handled-error/src/presentation.ts` and `remediation.ts` (record section 12). Subpaths:
`@langwatch/handled-error/presentation` (`explainAnyError`, `explainHandledError`), `/read-handled-error` (`readHandledError`,
`readErrorTraceId`), `/app-codes`, `/docs-url`.
`@langwatch/error-presentation` is a deleted spelling (section 15); a stale `packages/error-presentation/dist` may still sit on disk. Do not import it.

A new code needs copy: add it to the registry in the same change as the contract's `HandledError` subclass, or the screen
shows the generic "We've been notified" line.

## packages/error-views: what to render

`@langwatch/error-views` (`packages/error-views/src/views.tsx`) is the React half over the registry. It uses the design system.

| You have                                                | Use                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a whole page that failed to load                        | `<HandledErrorState error={error} fallbackTitle="Couldn't load datasets" />`                                                                                 |
| a failed read or action inside a page                   | `<HandledErrorAlert error={error} fallbackTitle=... onRetry={refetch} />` (`onRetry` adds a Try again button)                                                |
| a rejected form submit                                  | `<FormServerError form={form} />` in the form's whole-form slot                                                                                              |
| text copy without a component                           | `resolveErrorCopy({ error, title?, fallbackTitle? })`: title, description, tips, docsUrl, traceId; `ErrorActions` renders the trace id and docs link from it |
| a screen that must be read-only on an aggregate project | `<AggregateReadOnlyGate isAggregate={...}>` (`modules/dataset/browser/src/ui/sections/datasets.screen.tsx:22`)                                               |

The trace id is always offered. Keep the data you already have visible beside a failed refetch; show the alert, do not blank the page.

## @langwatch/browser-host/errors: toasts and forms

Host services, not components (`packages/browser-host/src/errors.ts`):

- `showErrorToast({ error, ...options })` for a failed action with no form. Never `toaster.create({ description: error.message })`.
- `applyHandledErrorToForm({ error, form, hasFormErrorSlot })` places the server's `meta.fieldErrors` on the fields and, when
  none apply and there is a whole-form slot, writes `root.serverError` (shown by `FormServerError`). It answers `true` when it
  placed something: then do not also raise a toast. Example: `modules/agent/browser/src/ui/sections/workflow-selector-drawer.tsx:1`.
- `markHandledGlobally` / `isHandledByGlobalHandler`: a global interceptor already reported this failure; do not report it again.
- Alert versus toast: an inline alert for a failure that belongs to the content on screen; a toast for a failed action whose
  context is gone. One failure is reported once.

## packages/design-system-internal: not the product

The paper look (cream paper, warm ink, one orange, serif headings) of the internal consoles: the haven hub and stack home,
the IdP simulator, the mail sink, the mail room and Storybook chrome (ADR 160, `packages/design-system-internal/README.md`).
React and CSS only, no Chakra, no product design system. Colours, fonts, radii and spacing come from its tokens and
`styles.css`; a console writes no literal of its own. The product UI never imports it; the only consumers are internal
consoles, `packages/design-system`'s Storybook tooling, `packages/mail`, `packages/sim-console`, `apps/*-web` and the haven
orb panel in `apps/ui/vite/haven-orb/`. If you are writing a customer screen, you want `design-system`.

## Traps

- Displaying `error.message`: the tRPC wire message is the code slug. Render from the registry.
- Importing `@langwatch/react-rum` in a module: the host owns it.
- Two copies of the form helper: `modules/auth/browser/src/model/apply-handled-error-to-form.ts` restates the host's
  `applyHandledErrorToForm`; prefer the host's in new code.
