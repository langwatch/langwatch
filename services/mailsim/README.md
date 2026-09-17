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
GET    /api/messages?to=&subject=
GET    /api/messages/{id}
GET    /api/messages/{id}/html
GET    /api/messages/wait?to=&subject=&timeout=30s
DELETE /api/messages
DELETE /api/messages/{id}
```

`to` and `subject` are optional case-insensitive substring filters. `wait`
long-polls: it answers immediately with an existing match, otherwise blocks
until one arrives or the timeout elapses (204).

## The browser inbox

`/` lists caught messages newest first and refreshes every two seconds.
The page identifies its stack, SMTP listener and whether messages survive
restarts. Recipient chips list addresses from retained mail with message counts;
selecting one filters the inbox. Any address can receive captured mail, but
capture does not create an application account. Each Haven stack has a separate
inbox even when the same address is used in several stacks.

Search by subject, sender or recipient. Clear the whole inbox or open a
message and delete it individually; both actions confirm first and report
request failures. Live refresh preserves focus and selected text.

A message has preview, plain-text and headers tabs (arrow keys also move
between them), extracted links with copy buttons, attachment metadata and a
JSON link. HTML renders inside a sandboxed `<iframe>` pointed at
`/api/messages/{id}/html` — a caught message is untrusted input, so that one
endpoint carries its own restrictive headers rather than the API's.

## SMTP intake

Accepts `AUTH PLAIN`/`AUTH LOGIN` with any credentials, and unauthenticated
delivery too — a production-shaped mailer configuration works against the
sink unchanged. Accepts any recipient (catch-all). A message over
`MAILSIM_MAX_MESSAGE_BYTES` (default 10 MiB) is refused at `DATA` time with a
permanent `552` naming the limit; nothing is stored. There is no outbound
network code path here at all.
