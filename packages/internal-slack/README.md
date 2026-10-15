# @langwatch/internal-slack

For messages LangWatch sends to its own Slack workspace only, never for anything a customer configures. Customer Slack (automation's alerts and reports) lives in `modules/automation`'s channels.

The Slack notices LangWatch posts to its own team: a new user, a subscription
starting or ending, a licence bought, a limit reached, a self-hosted lead. Each
is one typed template on one Block Kit layout, so every notice reads the same
way.

## The layout

`composeMessage` owns the look; a template only fills a `NoticeLayout`:

1. a header opening with one status emoji (`NOTICE_TONES`),
2. an optional one-line summary,
3. the fields, as bold label over value,
4. an optional quoted note,
5. buttons such as "Open org in admin" or "Open in Stripe",
6. a footer naming the environment and the moment it was sent, which Slack
   prints in each reader's own time zone.

Every message also carries a plain-text `text`, which is what a notification
and a screen reader show. Words from the product are escaped, so an
organization called `<!channel>` cannot mention anyone.

## Sending one

This package builds messages; it never sends them. The module that owns the
event renders the notice and posts it through its own Slack channel, to a
webhook URL it holds as a secret:

```ts
const message = subscriptionActivatedNotice.render({ props, origin });
await slack.send({ webhookUrl, message });
```

`render` parses the props, so a bad value throws where the notice is built.
Build it inside the same `try` as the send: a notice that fails is reported,
never thrown into the flow that raised it.

## Adding a notice

One file under `src/templates/`: a zod schema for the props, a `compose` that
returns the layout, and named fixtures of plainly invented data, all through
`defineNotice`. Then one line in `src/templates/index.ts`.

## Preview

```bash
pnpm --filter @langwatch/internal-slack preview                 # every notice
pnpm --filter @langwatch/internal-slack preview new-user        # just these ids
```

Prints each fixture's JSON and a Block Kit Builder link that renders it.

## Tests

```bash
pnpm --filter @langwatch/internal-slack test
```

Per notice, per fixture: it renders, its header opens with one status emoji,
it has a fallback text, every link in the props becomes a button, and the
blocks match a stored snapshot. Scenarios: `specs/internal-notices/slack-notices.feature`.
