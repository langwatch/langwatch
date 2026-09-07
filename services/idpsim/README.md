# idpsim — local identity-provider simulator

One Go process that plays the customer's IdP so enterprise identity flows can
be exercised on a laptop with no external IdP account. It serves a **range of
independent tenants** (`/t/1` … `/t/N`), each of which is:

- an **OIDC provider** — discovery, JWKS, authorization code + PKCE, userinfo
- a **SAML identity provider** — metadata and an SSO endpoint that signs
  assertions for any service provider's request (permissive by design)
- a **SCIM 2.0 directory** — Users/Groups CRUD + PATCH behind a deterministic
  bearer token, plus a connection to a real SCIM service provider it *pushes*
  its directory at and reads back (the Okta/Entra role, aimed at the app's SCIM
  endpoints)
- a fake **domain owner** — `acme<n>.test` pre-seeded with a DNS TXT record
  (served by idpsim's own UDP DNS listener) and an HTTP well-known token, for
  domain-verification testing. The app-side verification feature is greenfield;
  both proofs are ready for it.

Everything is in-memory and reset at boot. Nothing here is production code.

## Running

```bash
haven idp                        # ONLY the simulator — no app, API or databases —
                                 #   routed at idp.langwatch.localhost
haven idp --tenants 20           # same, with a wider range
make service svc=idpsim          # run once (SERVER_ADDR :5565, DNS :15353)
make service-watch svc=idpsim    # live reload via air
IDPSIM_TENANTS=20 make service svc=idpsim   # a wider range
```

Under haven the lane is **on by default** in every stack (`haven up -idp`
turns it off for a worktree), routed at `idp.<slug>.langwatch.localhost`.

Open `/` for the tenant list, and `/t/<n>/` for a tenant's own page: register
an application, copy the values the setup wizard asks for, see its users, and
watch a live feed of everything it serves or refuses. `GET /control/state` is
the same as JSON.

## Registering an application

LangWatch's single sign-on setup shows you a redirect address ending in
`{connection}` — the real id only exists *after* you register the connection,
which you cannot do until the identity provider is set up. Paste the address
into the tenant page exactly as shown: a `{placeholder}` segment here matches
whichever id turns up, so the circle breaks and you never have to come back.

Registering hands back the three values the wizard's *Then tell us about it*
step asks for, under the same names:

| Wizard field   | Where it comes from                     |
| -------------- | --------------------------------------- |
| Name           | whatever you called the application      |
| Issuer address | the tenant's base address, `…/t/<n>`     |
| Client id      | minted at registration                   |
| Client secret  | minted at registration                   |

For the SAML half the tenant page carries the sign-in address, entity id and a
copyable signing certificate, plus a link to the metadata document if you would
rather paste that.

Registration also switches enforcement on **for that client**: it must present
its secret and one of its redirect addresses, so a mistyped secret or address
fails loudly instead of mysteriously. A client id the tenant does not know is
still accepted with anything — that keeps the zero-setup path working — and the
activity feed says which of the two happened.

`POST /control/t/<n>/apps` does the same thing from a script:

```bash
curl -X POST localhost:5565/control/t/1/apps \
  -d '{"name":"LangWatch","redirectUris":["https://app.example/api/auth/sso/callback/{connection}"]}'
```

## Watching a tenant

The tenant page's activity feed is live, and `GET /control/t/<n>/activity` is
the same feed as JSON. Every authorization, token exchange, userinfo call, SAML
assertion, SCIM operation and domain-verification lookup lands there with an
outcome and a plain-language reason — which is usually the fastest way to find
out whether a login even reached the identity provider, and what it objected to
if it did.

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

## Provisioning into LangWatch

SCIM runs one way: the identity provider sends its directory to the
application, so **the application issues the credential**. LangWatch mints its
SCIM token — or takes one you already had — and the provider presents it. A
token this simulator generated would open nothing, so the tenant page has a box
to paste LangWatch's into rather than a value to copy, the same way the DNS
registry takes LangWatch's verification value rather than inventing one.

Open a tenant page, fill in LangWatch's SCIM address and token under
**Provision into LangWatch**, and you get two presses:

- **Push the directory** — every user then every group as a SCIM create,
  carrying that token, with seeded member ids mapped onto the ids LangWatch
  minted.
- **Read it back** — what LangWatch says it holds now, which is the half that
  tells you what it made of them.

Both are recorded in the tenant's activity feed, and the last one is reported
on the page.

The same from a script:

```bash
curl -X PUT localhost:5565/control/t/1/scim-target \
  -d '{"baseUrl":"http://localhost:5560/api/scim/v2","token":"<the token LangWatch issued>"}'
curl -X POST localhost:5565/control/t/1/scim-push   # -> {"usersCreated":2,"groupsCreated":1}
curl -X POST localhost:5565/control/t/1/scim-pull   # -> {"users":[…],"groups":[…]}
```

`scim-push` and `scim-pull` still accept `{"target":…,"token":…}` in the body
for a caller that would rather not connect first, and `DELETE
/control/t/1/scim-target` forgets the connection. Resetting a tenant does not:
putting the seeded users back is not a reason to forget where they were going.

Two SCIM tokens live on the tenant page and they point opposite ways. The one
under *Directory and domain* is the way **in** — it guards the tenant's own
SCIM server at `/t/<n>/scim/v2`, for testing the client side of provisioning —
and the one you paste is the way **out**. Pasting the first where the second
belongs is refused rather than left to fail as an unauthorized push.

## Domain verification

DNS: point the verifier's resolver at the DNS listener —
`dig @127.0.0.1 -p 15353 TXT acme1.test`. HTTP: any
`/.well-known/<file>` path answers with the domain's token, keyed by Host (or
an explicit `?domain=`). Configure more via
`PUT /control/dns/txt {"domain":…,"values":[…]}` and
`PUT /control/verification {"domain":…,"token":…}`.

Spec: `specs/setup/idp-simulator.feature`.
