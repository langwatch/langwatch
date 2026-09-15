# @langwatch/mail

The outbound mail gateways LangWatch sends through, and the fifteen transactional
messages the identity, organization and billing surfaces send.

## The preview studio

```bash
pnpm --filter @langwatch/mail dev     # http://localhost:5566
```

Every message, every fixture, rendered live. The left rail lists them; the centre
shows the email at desktop and mobile widths with HTML and plain-text tabs, a dark
preview toggle, copy-HTML and open-in-new-tab; the right pane is a form generated
from the template's zod schema that re-renders as you type. Props that fail the
schema are shown as a rejection rather than a broken email.

It renders in Node through the same `@react-email` call the product sends with, so
the preview cannot drift from the mail that arrives. Editing a template file
re-renders it without a restart.

A **Gallery** toggle next to Inspect shows every registered template's first
fixture at once as a grid of scaled thumbnails (a "every fixture" toggle shows
all twenty); clicking a card opens it in Inspect. Both views follow the
system colour scheme by default, with a light / system / dark override to
preview the other scheme on demand.

## Adding a template

Five things, all in one file under `src/templates/`:

1. **A zod schema** for the props. Types come from it with `infer` — never declare
   both. Give fields a `.describe()` where the name alone will not do; the studio
   shows it as a hint.
2. **A subject function** taking those props.
3. **A component** built on `EmailLayout` from `./email-layout`, using its
   `Paragraph`, `PrimaryButton`, `DetailTable`, `TintPanel`, `CodeBlock` and
   `InlineLink`. Do not write your own shell or your own colours.
4. **Named fixtures** — realistic, plainly invented data (`acme.example`,
   `Morgan Ellis`). One per state worth looking at, not one per template.
5. **`defineTemplate({ id, title, sentWhen, schema, subject, Component, fixtures })`**,
   then one line in `src/templates/index.ts`.

A `sendXEmail` wrapper goes underneath if this package owns the whole send; a
message whose envelope belongs to a process exports a render function instead and
gains a method on `MailRenderPort`.

Forgetting step 5 fails `src/templates/__tests__/mail-templates.unit.test.tsx` —
the registry is checked against the folder, so a template cannot go missing.

## The design system

Mail is **expressive**, not **productive** — the pair of names is IBM Carbon's.
Expressive is the marketing site's language and the front door's: cream page, paper
card, serif display line, an ink pill for the action, the brand orange kept for
details. Productive is the application's own working surface, with its own orange
(`#ED8926`), and it belongs nowhere in an email: these are read outside the product
by somebody usually not signed in, and the link lands them on the front door.

Every message is declared twice — inline for the clients that read nothing else,
and once more under `prefers-color-scheme: dark`. A test asserts both are present.

## The build

```bash
pnpm --filter @langwatch/mail build   # tsc -> dist/, ESM + source maps
```

This is the one workspace feature package that ships compiled JavaScript rather
than its own source, and the reason is the templates: they are `.tsx`, and the
three Node processes run TypeScript through `node --experimental-transform-types`,
which cannot load a `.tsx` file at all. So `exports` points a runtime at
`dist/index.js` while `types` still points at `src/index.ts` — a consumer
typechecks against the source it can read, and nothing goes stale between them.

tsc is the whole build. `rewriteRelativeImportExtensions` rewrites the `.ts` and
`.tsx` specifiers to `.js` on the way out, so no bundler has to be taught the
package's shape, and `dist` mirrors `src` file for file.

`dev/scripts/ensure-built.mjs` rebuilds it when `src` is newer than `dist`. The
`predev` hook of the api and the worker runs it, as do their `pretest` hooks, and
the image builds it the way pnpm builds any workspace dependency. Running one of
those is what keeps a rebuild out of your hands.

The studio and the tests read `src` directly, so neither needs a build.

## Sending in development

Nothing here reads an environment variable. A gateway takes its
`MailerConfiguration` from the process that composed it, so to send for real you
run the API or worker with a provider configured (`ses`, `sendgrid`, `smtp` or
`resend`) and trigger the flow. With no provider configured the send is a no-op and
the surface that called it still completes — check `hasEmailProvider` if you need
to know which.

To see the words without sending anything, use the studio.

## Tests

```bash
pnpm --filter @langwatch/mail test:unit
```

Per template, per fixture: it renders, it has a subject and a plain-text body,
every link in the props survives into the HTML, both colour schemes are declared,
the wordmark is there, no productive-system colour leaked in, and the HTML matches
a stored snapshot. Snapshots are right here because the rendered email **is** the
product. Scenarios: `specs/mail-templates.feature`.
