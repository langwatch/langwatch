---
name: design-system
description: "Where LangWatch's UI components, tokens and Chakra setup live, and the pattern docs to read before building a screen, list, drawer, settings page or chart. Use when someone asks which component to use, how to theme something, why Chakra is not imported directly, or before writing any non-trivial UI in apps/ui or a *-web package."
user-invocable: true
argument-hint: "[component or pattern]"
---

# Design system

`@langwatch/design-system` (`packages/design-system`) owns Chakra v3 (`^3.36.0`) for the
whole repository. Feature web packages and `apps/ui` import from it, not from
`@chakra-ui/react`. It is one of the two package roles `ui-screen-closure` always allows
inside a screen's closure, so a component reached through it never breaks a closure.

Look here before writing a component:

- `packages/design-system/src/components/` — the components, one file each, exported by
  a named subpath (`@langwatch/design-system/avatar`, `/checkbox`, …).
- `packages/design-system/src/system/` — the Chakra system, tokens and recipes.
  `@langwatch/design-system/provider` and `/color-mode` are the app-level wrappers,
  `/testing` the render helpers.
- `packages/design-system/src/index.ts` — the formatters and small pure helpers
  (money, metrics, slugify, text overflow); do not reimplement one in a module.
- `packages/design-system/stories/` for what a component looks like,
  `packages/design-system/specs/` for what it promises.

Read before building, not after:

- `dev/docs/best_practices/react.md` — the house React rules.
- `dev/docs/best_practices/drawers.md` — drawers are URL-routed singletons with a stack.
- `dev/docs/best_practices/row-actions-overflow-menu.md`,
  `dev/docs/best_practices/selection-action-bar.md` — list surfaces.
- `dev/docs/best_practices/scope-selector-and-badges.md`,
  `dev/docs/best_practices/scoped-resources.md` — scope selection is always
  `ScopeChipPicker`, never a hand-rolled Select.
- `dev/docs/best_practices/copywriting.md` — no abbreviations, no internals in copy.

A component that a second module needs is published as a surface, not copied; see
`.claude/skills/module/references/web-surface.md`. A component the whole product needs
belongs in the design system. Adding one there means a story and a spec scenario
alongside it.
