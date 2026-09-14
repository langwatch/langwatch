# mailsim — local mail sink

One Go process that plays the outside world's mailbox: it catches every
message the stack sends over SMTP, stores it, and relays nothing anywhere —
whatever the recipient's domain, so a test can safely address real-looking
addresses. Everything is in-memory by default, or file-backed under
`MAILSIM_DATA_DIR` so a restart mid-test does not lose a message.

## Running

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

`/` lists caught messages newest first; opening one shows its headers and
text, and renders its HTML body inside a sandboxed `<iframe>` pointed at
`/api/messages/{id}/html` — a caught message is untrusted input, so that one
endpoint carries its own restrictive headers rather than the API's.

## SMTP intake

Accepts `AUTH PLAIN`/`AUTH LOGIN` with any credentials, and unauthenticated
delivery too — a production-shaped mailer configuration works against the
sink unchanged. Accepts any recipient (catch-all). A message over
`MAILSIM_MAX_MESSAGE_BYTES` (default 10 MiB) is refused at `DATA` time with a
permanent `552` naming the limit; nothing is stored. There is no outbound
network code path here at all.
