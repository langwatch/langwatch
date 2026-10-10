---
name: webauthnsim
description: "Emulate passkeys, security keys and U2F tokens in a test browser with Chromium's virtual WebAuthn authenticators: `haven browser authenticator` on a haven browser lane, `addVirtualAuthenticator` in the Playwright e2e suites. Use when someone says 'webauthnsim', 'test passkeys', 'fake a security key', 'virtual authenticator', 'hardware token', 'YubiKey in a test', 'fail the fingerprint', 'user verification fails', or 'list the passkeys the browser holds'."
user-invocable: true
---

# webauthnsim

A WebAuthn ceremony runs in the browser, so the stand-in is in the browser too: Chromium's
CDP `WebAuthn` domain attaches a virtual authenticator to a page. The server path
(`@simplewebauthn`) is real; nothing is stubbed. There is no Go service and no console.
Spec: `specs/setup/haven-webauthnsim.feature`.

## Kinds

| `--kind`            | protocol | transport  | resident key | user verification |
| ------------------- | -------- | ---------- | ------------ | ----------------- |
| `passkey` (default) | ctap2    | `internal` | yes          | yes               |
| `security-key`      | ctap2    | `usb`      | no           | no (presence)     |
| `u2f`               | u2f      | `usb`      | never        | never             |

`--uv yes|no` and `--resident yes|no` override the defaults (not on `u2f`). Presence is
always simulated: no touch prompt waits.

## From a terminal or agent (`haven browser`)

Per lane, on that lane's page context; `--json` on every verb.

```
haven browser open <url> --lane <l> [--as admin]
haven browser authenticator add --lane <l> [--kind passkey|security-key|u2f] [--uv yes|no] [--resident yes|no]
haven browser authenticator list --lane <l>        # id, kind, uv; credentials: id, rpId, userHandle, signCount
haven browser authenticator uv --lane <l> <id> no  # every user verification fails until `uv <id> yes`
haven browser authenticator remove --lane <l> <id>
```

- Attach one authenticator per ceremony: with several, Chromium may ask one that cannot
  satisfy the request (a u2f key for a resident passkey) and the page sees `NotAllowedError`.
- Authenticators live with the lane's page: `close`, idling out, `state-load` or a new
  `--as` drops them and their credentials. Private keys are never listed.

## In the Playwright e2e suites

`dev/tests/agentic-e2e/tests/front-door/webauthn.ts`:

```ts
const authenticator = await addVirtualAuthenticator(page, { kind: "security-key" });
await authenticator.session.send("WebAuthn.setUserVerified", {
  authenticatorId: authenticator.authenticatorId,
  isUserVerified: false,
});
await removeVirtualAuthenticator(authenticator);
```

The default kind is `passkey`; `front-door/passkeys.test.ts` is the worked example.
