---
name: chakra-ui-builder
description: "Build or theme Chakra UI v3 components, recipes, slot recipes and tokens INSIDE packages/design-system only. Use only when editing files under packages/design-system. Feature code in modules/*/browser or apps/ui never imports Chakra: use the design-system skill instead."
---

# Chakra UI Builder

You are building UI with Chakra UI v3 and helping developers set up Chakra UI in
their projects. Your job is to produce clean, accessible, responsive code that
fits the project — not generic boilerplate. Read the project context first, then
build or set up.

---

## Scope

This skill is for **implementation work inside `packages/design-system`**: a component, a
recipe or a token. A module or app never imports Chakra; it takes a component from
`@langwatch/design-system/<subpath>` (see the `design-system` skill). Raw Chakra examples below
are implementation-only: never copy them into `modules/*/browser` or `apps/ui`.

## Step 1: Read the project context

The setup already exists. Do not install Chakra, run the CLI snippet generator or write a
second provider and theme.

- Provider: `packages/design-system/src/provider/index.tsx`; the Vite composition root is
  `apps/ui/src/main.tsx`.
- System, tokens and recipes: `packages/design-system/src/system/config.ts` and
  `create-system.ts`. Change tokens there; do not add a `theme.ts` beside it.
- Components: `packages/design-system/src/components/<concern>/` (`forms`, `layout`, `overlays`,
  `display`, `states`, ...), each with a story and a subpath in `package.json` `exports`.
- Drawer, Dialog and Card are callable shapes with closed props; build with them, not from raw
  parts (`design-system` skill, `references/component-apis.md`).
- The app is a Vite SPA on Chakra v3. There is no Next.js, no `"use client"`, no `next/link`.

If the requirements are vague or the choices matter (layout direction, data shape, variants), ask
before building.

---

## Step 2: Choose the right layout primitives

Reach for the right Chakra primitive rather than wrapping everything in `Box`:

| Need                     | Use                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Vertical stack of items  | `Stack` (default) or `VStack`                                                                   |
| Horizontal row           | `HStack` or `Flex`                                                                              |
| CSS Grid                 | `Grid` + `GridItem`                                                                             |
| Equal-column grid        | `SimpleGrid columns={N}`                                                                        |
| Centered page content    | the product layout component (`PageLayout`), or `Container` with a size from `system/config.ts` |
| Full flexbox control     | `Flex` with explicit props                                                                      |
| Semantic section/article | `Box as="section"` / `Box as="article"`                                                         |

Avoid deep nesting. If you're three `Box` levels deep with no semantic reason,
flatten it. Prefer `gap` over margin between siblings.

---

## Step 3: Use tokens, not raw values

Chakra v3 ships semantic tokens that automatically adapt to light/dark mode.
Prefer them over hard-coded palette values — they make the component theme-aware
without any extra work.

```tsx
// Prefer semantic tokens
<Box bg="bg.subtle" color="fg" borderColor="border.subtle" />
<Text color="fg.muted" />
<Box shadow="md" rounded="lg" />

// Use colorPalette for interactive components (not colorScheme)
<Button colorPalette="blue">Submit</Button>
<Badge colorPalette="green">Active</Badge>
```

Inside the design system, raw palette values (`blue.500`) are allowed only when a specific
colour is intentional and should not shift with colour mode, and new colours are made as
semantic tokens in `system/config.ts` with a light and a dark value. The foreground token is
`fg` (`fg.DEFAULT` in the config), not `fg.default`. Outside the package, only semantic tokens.

---

## Step 4: Responsive styles

Chakra uses mobile-first breakpoints. Use array or object syntax consistently:

```tsx
// Array: [base, sm, md, lg, xl]
<Box px={[4, 6, 8]} fontSize={["sm", "md", "lg"]} />

// Object: explicit breakpoints
<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={6} />
<Stack direction={{ base: "column", md: "row" }} gap={4} />
```

Every layout component should handle at least `base` (mobile) and `md` (desktop)
breakpoints unless the request is explicitly desktop-only.

---

## Step 5: Forms

Use `Field.Root` for all form fields — it wires up label, input, error, and help
text correctly:

```tsx
<Field.Root invalid={!!error} required>
  <Field.Label>Email address</Field.Label>
  <Input type="email" placeholder="you@example.com" />
  <Field.ErrorText>{error}</Field.ErrorText>
  <Field.HelperText>We'll never share your email.</Field.HelperText>
</Field.Root>
```

For form submission state, use `disabled` (not `isDisabled`) on inputs and
buttons. Group related fields in a `Stack gap={4}`.

---

## Step 6: Accessibility

Chakra's built-in components handle most accessibility automatically — don't
override it. The things you do need to provide:

- **Icon-only buttons**: always add `aria-label`
  ```tsx
  <IconButton aria-label="Close dialog">
    <CloseIcon />
  </IconButton>
  ```
- **Images**: always pass meaningful `alt` text (or `alt=""` for decorative)
- **Form labels**: use `Field.Label` or ensure `htmlFor` matches the input `id`
- **Interactive custom elements**: if you build something with `onClick` on a
  `Box`, use `as="button"` or an actual `<button>` so keyboard navigation works
- **Semantic headings**: use `h1`–`h6` hierarchy; don't skip levels
- **Color contrast**: don't use light gray text on white backgrounds; rely on
  semantic tokens which are contrast-tested

---

## Step 7: When to extract components, use recipes, and customize the theme

Extract a component when the same structure appears more than twice, or when a
piece is complex enough that naming it makes the parent clearer.

Suggest a **recipe** when a component has meaningful style variants that a
developer would want to customize. Suggest a **slot recipe** for components with
multiple coordinated parts (card with header/body/footer, stat with
label/value/icon, etc.).

For deeper theming work: defining brand color tokens, semantic tokens with dark
mode values, full recipe/slot-recipe authoring, typegen, or ejecting the default
theme — read `references/theming.md` before responding. It covers the complete
`defineConfig` / `createSystem` API with full examples.

For any chart request (bar charts, area charts, line charts, pie/donut charts,
`BarList`, `BarSegment`, or anything involving `@chakra-ui/charts`) read
`references/charts.md` before responding. It covers the `useChart` hook, all
three chart types, Recharts integration, color tokens, and complete runnable
examples.

When you're unsure which component to use, or the user hasn't specified one,
read `references/component-decision-tree.md`. It covers every Chakra component
with guidance on when to choose one over a similar alternative.

---

## Output format

Produce:

1. **Complete, runnable code** — correct imports, no placeholders like `TODO` or
   `...rest of component`
2. **Proper import statements** — group Chakra imports, then local imports
3. **Component separation** — split into multiple components/files if the
   component is complex or contains clearly separable parts
4. **Responsive styles** — at minimum `base` and `md` breakpoints for layout
5. **Brief explanation after the code** — 2–4 sentences on the key decisions
   made (layout approach, accessibility choices, responsive strategy). Skip the
   explanation if the request was trivial.

```tsx
// Good import style
import { Box, Button, Field, Stack, Text } from "@chakra-ui/react";
// Then local
import { SomeLocalComponent } from "./SomeLocalComponent";
```

---

## When to ask first

Build immediately if the request is clear enough to produce something useful.
Ask first when:

- The data shape is unknown and it changes the entire structure (e.g., "build a
  table" — how many columns? what data?)
- There are meaningful design choices the user might care about (layout
  direction, number of columns, color palette)
- The user references files or existing components you haven't seen

When in doubt, state your assumptions at the top of the response and build —
it's faster for the user to redirect from something concrete than from nothing.
