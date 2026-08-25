# idpsim — local identity-provider simulator

One Go process that plays the customer's IdP so enterprise identity flows can
be exercised on a laptop with no external IdP account. It serves a **range of
independent tenants** (`/t/1` … `/t/N`), each of which is:

- an **OIDC provider** — discovery, JWKS, authorization code + PKCE, userinfo
- a **SAML identity provider** — metadata and an SSO endpoint that signs
  assertions for any service provider's request (permissive by design)
- a **SCIM 2.0 directory** — Users/Groups CRUD + PATCH behind a deterministic
  bearer token, plus a control-API action that *pushes* the tenant's directory
  at a real SCIM service provider (the Okta/Entra role, aimed at the app's
  SCIM endpoints)
- a fake **domain owner** — `acme<n>.test` pre-seeded with a DNS TXT record
  (served by idpsim's own UDP DNS listener) and an HTTP well-known token, for
  domain-verification testing. The app-side verification feature is greenfield;
  both proofs are ready for it.

Everything is in-memory and reset at boot. Nothing here is production code.

## Running

```bash
make service svc=idpsim          # run once (SERVER_ADDR :5565, DNS :15353)
make service-watch svc=idpsim    # live reload via air
haven up +idp                    # as a haven lane — sticky, routed at
                                 #   idp.<slug>.langwatch.localhost
IDPSIM_TENANTS=20 make service svc=idpsim   # a wider range
```

Open `/` for the index page: every tenant with its issuer, SAML metadata, SCIM
base + token, and seeded users. `GET /control/state` is the same as JSON.

| Variable          | Default                  | Meaning                                    |
| ----------------- | ------------------------ | ------------------------------------------ |
| `SERVER_ADDR`     | `:5565`                  | HTTP listen address                        |
| `IDPSIM_BASE_URL` | `http://localhost:5565`  | External base for issuer/metadata URLs     |
| `IDPSIM_TENANTS`  | `3`                      | Tenant range size (1–100)                  |
| `IDPSIM_DNS_ADDR` | `:15353`                 | Verification DNS UDP listener; `off` disables |

Under haven the lane gets `SERVER_ADDR` and `IDPSIM_BASE_URL` injected, and
worktrees running (or falling back to) the lane see `LANGWATCH_IDPSIM_URL` in
their overlay.

## Pointing the app at a tenant

The app is an OIDC relying party with one provider per deployment, selected by
env. Tenant 1 as the deployment's IdP:

```bash
NEXTAUTH_PROVIDER=oidc
OIDC_ISSUER=http://localhost:5565/t/1     # or the haven URL + /t/1
OIDC_CLIENT_ID=anything                   # idpsim accepts any client
OIDC_CLIENT_SECRET=anything
```

The authorize endpoint serves an account picker; add `login_hint=<email>` for
a zero-click login in automated tests. Seeded users per tenant:
`admin@acme<n>.test` and `member@acme<n>.test`.

To exercise the app's Auth0-brokered-SAML handling (`samlp|` subjects,
ADR-096) over plain OIDC:

```bash
curl -X POST localhost:5565/control/t/1/config -d '{"samlpSubjects":true}'
```

## Driving SCIM at the app

```bash
curl -X POST localhost:5565/control/t/1/scim-push \
  -d '{"target":"http://localhost:5560/api/scim/v2","token":"<app scim token>"}'
```

pushes the tenant's users and groups as SCIM creates. The tenant's own SCIM
*server* lives at `/t/<n>/scim/v2` (bearer `idpsim-scim-token-<n>`) for
testing the client side of provisioning.

## Domain verification

DNS: point the verifier's resolver at the DNS listener —
`dig @127.0.0.1 -p 15353 TXT acme1.test`. HTTP: any
`/.well-known/<file>` path answers with the domain's token, keyed by Host (or
an explicit `?domain=`). Configure more via
`PUT /control/dns/txt {"domain":…,"values":[…]}` and
`PUT /control/verification {"domain":…,"token":…}`.

Spec: `specs/setup/idp-simulator.feature`.
