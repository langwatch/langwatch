# mailsim — local mail sink

One Go process that plays the outside world's mailbox: it catches every
message the stack sends over SMTP, stores it, and relays nothing anywhere —
whatever the recipient's domain, so a test can safely address real-looking
addresses. Everything is in-memory by default, or file-backed under
`MAILSIM_DATA_DIR` so a restart mid-test does not lose a message.

## Running

`haven up` runs the copy bundled into the Haven binary, including from an
older worktree without this package. Open the stack's `mail` link on the Haven
web dashboard to view its inbox. Use the source commands below when developing
the simulator itself.

```bash
make service svc=mailsim            # run once (HTTP :5580, SMTP :5581)
make service-watch svc=mailsim      # live reload via air
MAILSIM_DATA_DIR=/tmp/mailsim make service svc=mailsim   # messages survive a restart
```

## The HTTP API

```
GET    /healthz
GET    /api/inbox
GET    /api/messages?to=&subject=
GET    /api/messages/{id}
GET    /api/messages/{id}/html
GET    /api/messages/wait?to=&subject=&after=&timeout=30s
DELETE /api/messages
DELETE /api/messages/{id}
```

`to` and `subject` are optional case-insensitive substring filters. `wait`
long-polls: it answers immediately with an existing match, otherwise blocks
until one arrives or the timeout elapses (204). `after`, a message id, narrows
it to mail caught after that message. `/api/inbox` names the stack, the SMTP
listener, the base URL and whether messages persist.

## The browser inbox

The inbox is `apps/mailsim-web`, a React app on the internal console kit,
built by Vite into `web/dist` and embedded in this binary
([ADR-160](../../dev/docs/adr/160-internal-consoles-are-go-served-react.md)).
Build it with `pnpm --filter @langwatch/mailsim-web build` before building the
Go binary; a binary built without it answers every page with a line naming
that command. Every non-API path serves the app, so `/messages/{id}` links to
one message.

The page names its stack, SMTP listener and whether messages survive restarts.
The message list sits beside a reading pane (stacked under 720px), with search
and a recipient filter. New mail appears as it lands: the app long-polls
`/api/messages/wait?after=<newest id>` and re-reads the list whenever the wait
answers or lapses. Clearing the inbox and deleting a message each take a second
press to confirm. "Notify me" raises a desktop notification per arrival, asking
for permission only when pressed.

A message shows its sender, recipients, time and size, then preview, plain
text (URLs are links), HTML source and headers tabs, its links with copy
buttons and its attachment metadata. HTML renders inside a sandboxed
`<iframe>` pointed at `/api/messages/{id}/html`: a caught message is untrusted
input, so that one endpoint carries its own restrictive headers rather than
the API's.

## SMTP intake

Accepts `AUTH PLAIN`/`AUTH LOGIN` with any credentials, and unauthenticated
delivery too — a production-shaped mailer configuration works against the
sink unchanged. Accepts any recipient (catch-all). A message over
`MAILSIM_MAX_MESSAGE_BYTES` (default 10 MiB) is refused at `DATA` time with a
permanent `552` naming the limit; nothing is stored. There is no outbound
network code path here at all.
