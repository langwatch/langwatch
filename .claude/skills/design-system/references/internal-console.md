# Internal consoles: `@langwatch/design-system-internal`

The haven hub and stack home, the simulator consoles and the chrome of the mail room and Storybook
are a separate design language from the product: cream paper, warm ink, one orange, serif headings
(Sentient), mono details. React and CSS only; **no Chakra and no product design system**. Email
content is a third language (the `mail-template` skill); do not mix them.

- Authority: `packages/design-system-internal/README.md` (the brief) and
  `dev/docs/adr/160-internal-consoles-are-go-served-react.md`.
- A console imports `@langwatch/design-system-internal/styles.css` once in its entry and uses the
  package's components. It writes no colour, font size, radius, shadow or spacing literal; only
  layout glue (grid columns, a max width) in one `app.css`, using the tokens (`--paper`, `--ink-*`,
  `--brand`, `--moss`/`--amber`/`--rust`, `--space-*`).
- Light and dark are both required (`prefers-color-scheme` and `[data-theme="dark"]`). State is
  never colour alone: a dot always sits beside a word.
- Gallery: `packages/design-system-internal/gallery` shows every component.
- The haven icon source is `assets/haven.svg`; after editing it run
  `pnpm --filter @langwatch/design-system-internal generate:haven-icon`.
- Simulator console surfaces live in `apps/sims/src/<surface>` (the `sims` skill); the hub in
  `apps/haven-web`.
