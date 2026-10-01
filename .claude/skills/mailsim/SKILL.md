---
name: mailsim
description: "Catch, read and assert on the emails the LangWatch stack sends, using mailsim, haven's local mail sink. Use when someone says 'did the email send', 'where is the verification mail', 'invite link', 'wait for the email', 'mailsim', 'the mail sink', 'haven mail', 'test the reset email', or needs to load-test SMTP."
user-invocable: true
---

# mailsim

A local SMTP sink plus inbox. It catches every message the stack sends and relays
nothing, whatever the recipient domain. Code: `services/mailsim`, console
`apps/mailsim-web`.

## Run it

- On by default in haven (`haven up`; `-mail` turns it off). Hosted in the `sims` lane.
- URL: `https://mail.<slug>.langwatch.localhost` (console); `haven status` shows the
  loopback HTTP port (`MAILSIM_HTTP_ADDR`) and the SMTP port (`MAILSIM_SMTP_ADDR`).
- The app's own mail is routed at it (`SMTP_HOST=127.0.0.1`) unless `.env` names a provider.
- Standalone: `make service svc=mailsim` (HTTP :5580, SMTP :5581).

## Inspect and assert (HTTP)

```
GET    /api/messages?to=&subject=            newest first; case-insensitive substring filters
GET    /api/messages/{id}    /{id}/html      one message: text, html, headers, links
GET    /api/messages/wait?to=&subject=&after=<id>&timeout=30s
                                             long poll; 200 message, 204 on timeout
DELETE /api/messages   |   DELETE /api/messages/{id}
GET    /api/inbox                            stack, SMTP address, persistence
```

Test pattern: trigger the action, then `curl ".../api/messages/wait?to=a@x.test&subject=verify&timeout=20s"`
and read `links[0]`. Use `after=<newest id>` to ignore older mail.

## Seed and reset

- `MAILSIM_SEED=1` (haven sets it) delivers three sample messages at start.
- Reset with `DELETE /api/messages`. `MAILSIM_DATA_DIR` (haven sets it per slug) persists
  mail across restarts.

## Tests and load

- Send with any SMTP client to the SMTP port; no auth needed.
- Bounded: `MAILSIM_MAX_MESSAGES` (default 10000) keeps the newest and evicts the oldest;
  `MAILSIM_MAX_MESSAGE_BYTES` (default 10 MiB) caps one message. Id and recipient lookups
  are indexed. Benchmark: `go test -bench . -benchmem ./services/mailsim`.
