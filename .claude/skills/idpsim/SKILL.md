---
name: idpsim
description: "Test enterprise sign-on locally with idpsim, haven's identity-provider stand-in: OIDC, SAML, SCIM provisioning and domain verification with no external IdP account. Use when someone says 'haven idp', 'idpsim', 'fake IdP', 'test SSO locally', 'SAML login', 'OIDC provider', 'SCIM push', 'provision users', 'domain verification', 'DNS TXT proof', 'haven sim idp', 'idp console', or needs a directory of thousands of users to test a sync."
user-invocable: true
---

# idpsim

One Go process playing the customer's IdP across independent tenants (`/t/1` to `/t/N`):
an OIDC provider, a SAML identity provider, a SCIM 2.0 directory (it also pushes at
LangWatch's SCIM endpoint) and a fake domain owner (`acme<n>.test`, DNS TXT and a
well-known token). Permissive by design: never expose it. Code: `services/idpsim` (the
README there is the full reference), console `apps/idpsim-web` (ADR-160).

## Run it

- On by default in haven (`haven up -idp` turns it off). Hosted in the `sims` lane.
- Console: `https://idp.<slug>.langwatch.localhost`; tenant pages at `/t/<n>/`. `haven status`
  shows the loopback port and the DNS port (default `:15353`).
- The overlay sets `LANGWATCH_IDPSIM_URL`, `SSO_TRUSTED_IDP_ORIGINS` and
  `SSO_DOMAIN_PROOF_DNS_SERVERS` (`tools/thuishaven/domain/overlay.go`).
- State persists under haven's home per slug (`IDPSIM_DATA_DIR`), so a restart keeps
  registered apps, users and keys. A direct run with no data dir is in memory.
- Only the simulator, no stack: `haven simulator idp [--tenants <n>]`. Standalone from source:
  `make service svc=idpsim` (:5565). A wider range: `IDPSIM_TENANTS=20`.
- `haven sim idp status --json [--stack <slug>]` reads a running stack's identity-provider summaries.

## Use a tenant

- OIDC: issuer `<base>/t/<n>`, discovery at `/.well-known/openid-configuration`. Register
  the application on the tenant page (or `POST /control/t/<n>/apps`) to get client id and
  secret; an unknown client id is still accepted with anything.
- SAML: sign-in `<base>/t/<n>/saml/sso`, metadata `<base>/t/<n>/saml/metadata`.
- Zero-click login in a test: `login_hint=<email>`. Seeded users per tenant:
  `admin@acme<n>.test`, `member@acme<n>.test`.
- Activity (every authorize, token, assertion, SCIM call with an outcome and a reason):
  `GET /control/t/<n>/activity`, or the tenant page's activity tab. Read it first when a
  login fails: it says whether the request even arrived.

## Faults

- Console: the tenant page's **Signing** tab does every fault below (disabling a user is on **Users**):
  shows published key ids (which signs), skew and the armed break; rotates or drops a key,
  applies skew, arms any tamper mode (ID token or SAML), signs an unsolicited SAML response
  with a "Post it to the ACS" form, lists sign-in links (as `haven sim idp signin`) and resets.
  After any reload its skew and break inputs show the tenant's values again.
- `POST /control/t/<n>/tamper {"mode":"saml-bad-signature|saml-unsigned|saml-wrong-audience|saml-wrong-recipient|saml-expired|saml-not-yet-valid|saml-replayed-assertion|saml-wrong-in-response-to"}` breaks the next SAML response once (`haven sim idp fault <n> <mode>`).
- `POST /control/t/<n>/config {"skewSeconds":600}` runs the tenant clock ahead (negative = behind) for ID tokens and SAML assertions (`haven sim idp skew <n> <seconds>`).
- `POST /control/t/<n>/rotate-key {}` makes a new signing key current while JWKS and SAML metadata still publish the old one; `{"dropPrevious":true}` stops publishing it (`haven sim idp rotate-key <n> [--drop-previous]`). Reset clears skew but keeps keys.
- `POST /control/t/<n>/user-active {"user":"<email>","active":false}` disables a user at the IdP; OIDC and SAML sign-in refuse them (`haven sim idp user disable|enable <n> <email>`).
- `POST /control/t/<n>/saml/unsolicited {"acsUrl","email","entityId?","relayState?"}` returns `{url, samlResponse, relayState}` for an IdP-initiated post (`haven sim idp saml unsolicited <n> --acs-url <u> --email <e> [--relay-state <s>]`).

## Provisioning and domains

- SCIM out: `PUT /control/t/<n>/scim-target {"baseUrl","token"}` (the token is the one
  LangWatch issues), then `POST .../scim-sync` (the difference; `?dryRun=1`, `?groups=1`)
  or `POST .../scim-push` (everything, once). `.../scim-pull` reads LangWatch's side back.
- SCIM in (the app calling the simulator's own server): `/t/<n>/scim/v2`.
- Scale: `POST /control/t/<n>/population {"users":5000,"groups":12}` (caps 50,000 and 500),
  then `POST .../churn {"join":120,"leave":80,"rename":40}`. Seeded, so repeatable.
- Domain proof: `dig @127.0.0.1 -p 15353 TXT acme1.test`; HTTP: any `/.well-known/<file>`.
  More domains, one channel each: `PUT|DELETE /control/dns/txt {"domain","values"}`
  (`haven sim idp dns add|remove`) and `PUT|DELETE /control/verification {"domain","token"}`
  (`haven sim idp verification set <domain> <token>` / `clear <domain>`). Console: the **Domain**
  tab's "A TXT record on any domain" and "Well-known verification file" panels.
- SCIM events: the **Provisioning** tab's "Send one SCIM event" (shown when connected) has an
  Advanced section for `--id`, `--member-id`, `--set` (one `key=value` per line), `--inactive`,
  `--no-external-id` and the enterprise department, cost center and manager.

## From a terminal or agent

`haven sim idp <verb>` drives a running idpsim (`--json` on reads, `--stack <slug>` for another stack):
`tenants` (every tenant, as the console's landing page lists them), `tenant show <t>` (also prints signing keys, skew and the armed break), `apps add|remove`, `populate`, `churn`, `user add`, `scim target set|clear`,
`scim push|pull|sync`, `scim-event <t> <kind> [--style okta|entra] [--user] [--group] [--set k=v]`,
`dns add|remove`, `verification set|clear`, `activity`, `signin <t> --user <email>` (prints the IdP-initiated URL),
`reset`, `samlp <t> on|off`. Full table: `services/idpsim/README.md`.

- Legacy SSO: `haven sim idp legacy provider <t> auth0|okta|cognito|onelogin|azure|show`, then
  `haven sim idp legacy env <t>` for the env lines (apply with `haven down` then `haven up`).
  `azure` is Entra: the product's authority host is hard-wired, so resolve
  `login.microsoftonline.com` to idpsim over https; the env gives `AZURE_AD_TENANT_ID`.
- Legacy-SSO org (main's shape, no connection): `haven db seed --org name=<n>,plan=licence`, then set its
  `Organization."ssoDomain"` to `acme<t>.test` and `"ssoProvider"` to the legacy provider name over `haven db url`.
- Failed SCIM apply (needs `SCIM_V2_GRANTS=1` at `haven up`): push the org's last active admin `active=false`;
  it fails `cannot_remove_last_admin`, retires at once, and re-drives once another admin exists.
- `populate` also gives each user `department`, `costCenter` and `manager` (from `--seed`);
  pushes carry them under the SCIM enterprise extension.
- Negative tokens: `haven sim idp fault <t> bad-signature|wrong-audience|expired|replayed-nonce`
  breaks the next ID token once.
- Auth0 directory webhook: `haven sim idp auth0-webhook <t> --event create|deactivate --user <u>
--target <stack-url> --secret-env <VAR>`. The secret comes from your environment only; never
  put it in a flag, a file in the tree or a message.
- Bare `haven sim idp` no longer runs the standalone simulator; use the hidden `haven simulator idp`.

## Reset

- Resetting a tenant restores its seeded users and keeps its SCIM target.
- Login codes and access tokens are never persisted; a restart drops them.

## Spec and tests

`specs/setup/idp-simulator.feature`. Go tests: `go test ./services/idpsim`.
