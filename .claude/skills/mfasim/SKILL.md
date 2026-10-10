---
name: mfasim
description: "Emulate second factors in a test browser: passkeys, security keys and U2F tokens through Chromium's virtual WebAuthn authenticators, and TOTP (authenticator app) codes typed without the agent ever seeing the secret. `haven mfa` on a haven browser lane, `addVirtualAuthenticator` in the Playwright e2e suites. Use when someone says 'mfasim', 'test passkeys', 'fake a security key', 'virtual authenticator', 'hardware token', 'YubiKey in a test', 'fail the fingerprint', 'user verification fails', 'list the passkeys the browser holds', 'two-step verification', 'enrol TOTP', 'authenticator app code', 'one-time code', or 'type a wrong 2FA code'."
user-invocable: true
---

# mfasim

Second factors run in the browser, so the stand-in is in the browser too. The server path
(`@simplewebauthn`, the TOTP verifier) is real; nothing is stubbed. There is no Go service
and no console: `haven mfa` drives the `haven browser` daemon on a `--lane`, as `haven llm`
drives llmsim. Spec: `specs/setup/haven-mfasim.feature`.

```
haven browser open <url> --lane <l> [--as admin]
haven mfa add --lane <l> [--kind passkey|security-key|u2f] [--uv yes|no] [--resident yes|no]
haven mfa list --lane <l>             # id, kind, uv; credentials: id, rpId, userHandle, signCount
haven mfa uv <id> no --lane <l>       # every user verification fails until `uv <id> yes`
haven mfa remove <id> --lane <l>
haven mfa totp enroll [ref] --lane <l>        # reads the setup key off the page; prints only digits/period
haven mfa totp fill <ref> --lane <l> [--wrong] # types the current code (or a wrong one) into <ref>
```

`--json` on every verb. `--as` signs the lane in first, as on `haven browser`.

## Passkeys and security keys

| `--kind`            | protocol | transport  | resident key | user verification |
| ------------------- | -------- | ---------- | ------------ | ----------------- |
| `passkey` (default) | ctap2    | `internal` | yes          | yes               |
| `security-key`      | ctap2    | `usb`      | no           | no (presence)     |
| `u2f`               | u2f      | `usb`      | never        | never             |

`--uv yes|no` and `--resident yes|no` override the defaults (not on `u2f`). Presence is
always simulated: no touch prompt waits.

- Attach one authenticator per ceremony: with several, Chromium may ask one that cannot
  satisfy the request (a u2f key for a resident passkey) and the page sees `NotAllowedError`.
- Authenticators live with the lane's page: `close`, idling out, `state-load` or a new
  `--as` drops them and their credentials. Private keys are never listed.

## TOTP (authenticator app codes)

1. Open the two-step setup (Settings, your account, two-step verification) on a lane.
2. `haven mfa totp enroll --lane <l>`: the daemon reads the `otpauth://` URI or the setup key
   field (`data-testid="two-factor-shared-secret"`) itself; pass a snapshot ref when the key
   sits elsewhere. The QR image is not decoded: the page always shows the key as text too.
3. Snapshot to find the code field, then `haven mfa totp fill <ref> --lane <l>` and click
   Finish. At a sign-in challenge, the same `fill` on the same lane answers it.
4. `--wrong` types a well-formed code no verifier accepts (not the previous, current or next
   window's), for refusal tests.

The secret is kept in `~/.langwatch/portless/browser/<slug>/mfa/<lane>.totp.json` (mode 600) by the daemon.
No verb prints, logs or returns the secret or a code; `snapshot` and `eval` replace any key on
the page (raw, grouped by four, or in an `otpauth://` URI) with `***`, and `screenshot` masks
the setup code and key. Re-enrolling the lane overwrites the file; deleting it forgets it.

Enrol a throwaway user, never the shared `admin`: `haven auth` signs lanes in with a password
only, so a second factor on that account can stop every lane that signs in as it.

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
