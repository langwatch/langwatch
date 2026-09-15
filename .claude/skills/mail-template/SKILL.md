---
name: mail-template
description: Add or change one transactional email LangWatch sends — the props schema, the fixtures, the subject, the component on the shared expressive layout, the registry line, and the bound scenario. Covers the preview studio (pnpm --filter @langwatch/mail dev), why mail uses the expressive design system rather than the application's, how the dark cut is declared, and the render-versus-send split that keeps react-email off a worker's boot graph. Use whenever someone says 'add an email', 'change the wording of the invite mail', 'the reset email looks wrong', 'preview the emails', 'a new notification email', or a template renders without its link.
user-invocable: true
argument-hint: "<template id or what the message says>"
---

# Write a LangWatch email

Everything is in `packages/mail/src/templates/`. Read `packages/mail/README.md` first —
it is 78 lines and it is the contract. This is what it does not say.

## The five parts, in one file

`defineTemplate({ id, title, sentWhen, schema, subject, Component, fixtures })`, then one
line in `src/templates/index.ts`. Miss the line and
`__tests__/mail-templates.unit.test.tsx` fails — it reads the barrel's source against the
folder, so a template cannot go missing quietly.

Types come from the zod schema with `infer`. Never declare both.

## Expressive, not productive

Mail uses the **expressive** system (the marketing site and the front door), never the
**productive** one (the application). Concretely: build on `EmailLayout` and its
`Paragraph` / `PrimaryButton` / `DetailTable` / `TintPanel` / `CodeBlock` / `InlineLink`.
Write no colour of your own. The application's `#ED8926` in a rendered mail fails a test,
on purpose.

The primary action is an **ink pill**, not an orange slab. The brand orange lives in
details. Do not "fix" this.

## Traps

- **Adjacent JSX text splits.** `Message from {name}` renders `Message from <!-- -->Jane`,
  so a `toContain("Message from Jane")` fails. Interpolate the whole string:
  `` {`Message from ${name}`} ``.
- **No flexbox, no percentage-width `div`.** Outlook renders neither. Meters and columns
  are nested table cells — see `UsageLimitEmail`'s bar.
- **`EmailContent` has no `text` field.** `renderMailTemplate` returns one and the tests
  assert it, but the four providers do not send it yet. Do not add it here — that is
  transport work across `src/providers/*`.
- **No remote web font.** A font fetch from a mail client is an open-tracking pixel. The
  serif stack names Sentient and falls back; it is not loaded.
- **Render versus send.** A message whose envelope belongs to a process (BCC fan-out,
  unsubscribe footer, no-reply `To`) exports a render function and gains a method on
  `MailRenderPort`. Only a whole send gets a `sendXEmail`. Getting this wrong puts
  react-email on a worker's boot graph, which
  `packages/architecture-enforcer/tests/frontend-boundary.unit.test.ts` will catch.
- **Links arrive built.** A template never assembles a URL from a base host it read
  itself. The module that owns the destination passes the link.

## Check it

```bash
pnpm --filter @langwatch/mail dev          # the studio, http://localhost:5566
pnpm --filter @langwatch/mail test:unit    # add -u after a deliberate copy change
cd packages/mail && pnpm -s typecheck
```

Snapshots are legitimate here — the rendered email is the product — but update them only
when you meant to change the words. Scenarios live in
`packages/mail/specs/mail-templates.feature` and each needs a `@unit` tag plus a verbatim
`/** @scenario "<title>" */` above the `it(`.
