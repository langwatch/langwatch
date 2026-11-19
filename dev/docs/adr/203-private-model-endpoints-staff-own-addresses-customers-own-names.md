# ADR-203: Private model endpoints: staff own the addresses, customers own the names

**Date:** 2026-11-19

**Status:** Proposed

> Behavioural contract: [org-private-model-endpoints.feature](../../../specs/security/org-private-model-endpoints.feature)

## Context

Some SaaS customers run their own model gateway (an OpenAI-compatible proxy)
inside their cloud network, with no public endpoint, and want to use it as a
custom model provider. On AWS the customer exposes the gateway as a VPC
endpoint service, and our VPC consumes it over PrivateLink. The endpoint's
network interfaces have private addresses inside our VPC.

Hosted LangWatch refuses every model call to a private address
(`BLOCK_LOCAL_HTTP_CALLS=true`, `REQUIRE_HTTPS_CUSTOM_ENDPOINTS=true`). The only
exception mechanism is `ALLOWED_PROXY_HOSTS`. It cannot serve this case:

- **It is global.** A listed host is open to every tenant on the install.
- **It trusts a hostname, not an address.** A tenant who controls the public DNS
  of a listed name can point it at any address our resolver returns. Metadata
  addresses are always refused. Our databases, internal load balancers and the
  cluster API are not.
- **It does not reach the connection.** The AI gateway and nlpgo send model
  calls through Bifrost. Bifrost runs its own check at connect time with one
  switch, `NetworkConfig.AllowPrivateNetwork = !BlockLocalHTTPCalls`
  (`services/aigateway/adapters/providers/bifrost.go:1446`). With blocking on,
  no allowlist entry gets a model call to a private address, whatever it lists.

ADR-053 already sets the target. Private provider access is "an operator-created
connector" bound to an organization, and "a hostname suffix establishes neither
tenant ownership nor authorization to a particular PrivateLink endpoint." Its
full shape (a separate egress service and a signed envelope) is not built. This
ADR is the first slice of ADR-053 Track C, which works inside today's processes.
The signed bindings envelope below is also the first slice of ADR-053 Track A's
signed egress envelope: organization, project, destination and expiry, verified
by the process that dials.

The customer must also be able to manage this without a support ticket for
every change. The PrivateLink endpoint itself needs us (Terraform in our
account), but what they point at it should be theirs.

The managed-Bedrock path shows the gap for one provider kind:
`validateBedrockEndpoint` (`bedrock_vpce.go`) accepts any `*.vpce.amazonaws.com`
host from any tenant, and the customer's IAM policy is the only real gate. That
path is out of scope here.

## Decision

**The security boundary is the address, so staff own the addresses and
customers own the names.**

**Staff register a private endpoint for one organization in ops.** It is
created at the same time as the PrivateLink endpoint in our infrastructure, and
holds:

- the organization it belongs to;
- a display name and region (for example "Inference, eu-west-1");
- the exact IP addresses of the endpoint's network interfaces, which are stable
  for the endpoint's lifetime;
- the one TCP port allowed (443 by default).

Only the `ops:manage` platform permission can create, change or remove a private
endpoint.

**Customers bind hostnames to their private endpoints themselves.** In
organization settings, a member with `organization:manage` sees the private
endpoints staff registered for them (name, region and status, never the
addresses). They can add, change or remove hostname bindings, for example
`llm.internal.example.com`, the name their TLS certificate covers. Then they
configure the provider as usual, with `https://<hostname>` as the base URL.
Every change is recorded in the audit log.

**A bound hostname is never resolved.** A model call whose base URL host is
bound in the calling project's organization:

1. must use `https` on the private endpoint's port;
2. dials one of the private endpoint's registered addresses directly, with no
   DNS lookup;
3. keeps the hostname for TLS SNI, certificate verification and the `Host`
   header.

The customer can choose any name, because the name decides only which of _their
own_ endpoints a call reaches. They never enter an address, so they cannot aim a
call at anything else in our network. No private DNS zone is needed on our side.

A binding applies only to the organization's own provider credentials. If a
customer binds a public name such as `api.openai.com`, a call with their own
OpenAI key goes to their endpoint. That is their choice, and it reaches only
their own endpoint. A call made with a LangWatch platform key, or to the
LangWatch provider, never takes a binding: the AI gateway skips platform
credentials when it stamps bindings. nlpgo cannot yet tell a platform credential
from a customer one, so no organization may bind `langwatch.ai` or a name under
it.

A host that is not bound follows today's rules: public addresses pass, private
addresses are refused, and metadata addresses are always refused. An IP-literal
base URL can never be bound. Staff cannot register a metadata, loopback or
public address as a private endpoint address.

**Bindings travel with the call.** Go services get no database access for this:

- The TS app resolves the organization's bindings (hostname, addresses, port)
  and sends them to nlpgo in one header, `X-LangWatch-Private-Endpoints`, on
  every route: `/go/proxy/v1`, the studio's streaming and synchronous workflow
  routes, the scenario relay, and a project's own NLP Lambda.
- The AI gateway receives them in the control-plane config bundle, next to
  `Bundle.OrganizationID`.

**The signed envelope is the trust anchor for nlpgo.** The header value is
`base64url(JSON) + "." + base64url(Ed25519 signature)`, signed over the first
segment. The JSON is `{v: 1, organizationId, projectId, bindings, expiresAt}`,
with `expiresAt` in Unix seconds. The app signs with
`LANGWATCH_PRIVATE_ENDPOINTS_SIGNING_KEY`, which only the app holds.
`signPrivateEndpointsHeaders` in `@langwatch/model-provider-contract` builds the
header, and `ModelProviderApi.privateEndpointsHeadersForProject` is how a module
gets it. The app also sends `X-LangWatch-Project-Id`.

nlpgo verifies with `LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY`, a public key. It
accepts the envelope only when the signature is valid, the envelope has not
expired, and its `projectId` equals the request's project (the project header,
and the body's `project_id` on workflow routes). Any failure is a 400 with
reason `invalid_private_endpoints`; nlpgo never falls back to DNS for a refused
envelope. With no verify key, nlpgo ignores the header and logs a warning.
nlpgo never reads bindings from a request body: the app relays some bodies
unread (`/api/scenario/execute-sync`), so a body field could name any address.

The envelope is signed, not encrypted, so its registered addresses are readable
wherever it travels: a Lambda event, langevals' environment and request body.
They are our own VPC-internal endpoint addresses, not secrets; the organization
UI hides them for clarity, not confidentiality.

The expiry is 15 minutes for a workflow run, which nlpgo checks once, when the
request arrives. A scenario run gets one hour, because its child process reuses
one envelope for every turn.

**langevals never dials a bound host; nlpgo does.** langevals (LLM-as-judge and
ragas evaluators, and topic clustering) calls models through litellm, which
resolves the name through DNS. For a call whose base URL host is bound in the
project's organization, `ModelProviderApi.prepareLangevalsExecution` rewrites
the litellm parameters to an OpenAI-shape call to nlpgo's `/go/proxy/v1`: the
original parameters ride as `x-litellm-*` headers in `extra_headers`, next to
the signed envelope (valid for 30 minutes, which covers a clustering page). An
unbound call keeps its parameters exactly. nlpgo then verifies the envelope and
pins the call as it does for the playground, so there is no third
implementation of the address gate or the pinned dial.

The proxy wants the internal secret. The app sends it to langevals as a request
header, with the proxy's URL in `X-LangWatch-Engine-Proxy`, and only on a
request that has a proxied call. It never goes in the body: a large body is
staged in the project's object storage, which can be a customer's bucket.
langevals adds the secret to a call's extra headers only when that call goes to
exactly the named proxy (scheme, host, port and path). langevals runs no tenant
code, reads no bindings and chooses no address. A deployment where langevals
cannot reach the app's NLP service URL fails closed: the call errors, and
nothing is resolved through DNS.

An agent test turn signs the bindings in the parent and carries them on the
child's job, as a scenario run does. A workflow agent's turn sends them when it
posts straight to nlpgo; the relay route signs its own.

**The gateway's bundle stays unsigned.** The AI gateway fetches its bundle from
the control plane itself: it signs the request with its own internal secret
and verifies the answer's JWT. No tenant code runs in the gateway, and no
request body or header a tenant sends can set bindings. Signing the bundle would add a key to
rotate without removing any reachable attacker.

**One policy per call, every model path.** v1 covers every place that reaches a
custom model endpoint:

- the credential check when a provider is saved;
- model discovery;
- nlpgo's playground proxy (playground and prompts);
- nlpgo workflow LLM and evaluator blocks;
- langevals evaluators and topic clustering, through nlpgo's proxy;
- the scenario child (simulator, judge, prompt and workflow targets, and agent
  test turns);
- AI gateway virtual-key traffic.

Each path builds its endpoint policy from the global flags plus the call's
bindings. Bifrost gets a per-call dialer that applies the same rules, instead of
the `AllowPrivateNetwork` switch.

**Out of scope:** workflow HTTP blocks, webhooks, scenario HTTP agent targets
and code blocks. They stay on today's global policy. A binding authorizes model
calls, not arbitrary HTTP.

## Alternatives

- **Gate bindings on the internal secret.** The first version did this: nlpgo
  honoured bindings on any request that carried `LANGWATCH_NLP_INTERNAL_SECRET`.
  Rejected, for two reasons. The app adds the secret to calls whose body it
  relays from a tenant, so the secret says who sent the request, not who chose
  the bindings. And tenant code on a project's NLP Lambda can read that
  Lambda's environment, so any secret the Lambda needs to check bindings is a
  secret the tenant has. A signature fixes both: the Lambda holds only the
  public key, and only the app can produce an envelope it accepts.
- **A hostname list on `Organization`.** It is the smallest change, but it
  trusts DNS. A tenant with control of a listed name's DNS chooses which of our
  addresses we connect to. ADR-053 rejects hostname-only authorization for this
  reason.
- **Staff-only connectors (hostname plus addresses, all set in ops).** As safe
  as this decision, but every hostname change is a support ticket, and we must
  keep a private DNS record per customer hostname in our VPC.
- **Customers enter the addresses.** That puts the security boundary in the
  tenant's hands. They could register our RDS or cluster API addresses.
- **Resolve the bound hostname and require answers inside the registered
  addresses.** It is equally safe, but it needs a private DNS zone record per
  hostname for no gain, because the addresses are already known.
- **Address ranges instead of exact IPs.** The PrivateLink subnets also hold the
  NLP Lambdas and other customers' endpoints. A `/24` admits all of them.
- **Add the host to `ALLOWED_PROXY_HOSTS`.** It is global and does not get past
  Bifrost's connect-time check (see Context).
- **nlpgo looks bindings up by organization ID.** Requests would be smaller,
  but it adds an internal endpoint and a cache to nlpgo, plus one more thing to
  invalidate when a binding changes.
- **Build ADR-053's egress service first.** It is the right end state, but it
  is a new service, a new network domain and a migration of every caller, and
  the need today is one endpoint per customer. Private endpoints, bindings and the
  per-call policy all carry over to that service.

## Consequences

- One organization can reach exactly the private addresses staff registered for
  it, on one port, over TLS. No other tenant gains anything.
- Customers change hostnames without us. Staff are needed only when a
  PrivateLink endpoint is created, recreated or removed.
- Staff must record the endpoint's addresses when Terraform creates it, and
  update them if the endpoint is ever recreated. Stale addresses fail closed:
  calls fail to connect, and nothing else opens.
- Private endpoints and bindings are a data model ADR-053's egress service can
  take over as-is.
- The AI gateway's NetworkPolicy already limits private egress to the two
  PrivateLink subnets on 443. The TS app and nlpgo have no egress
  NetworkPolicy, so for them the app-layer check is the only gate. Infra
  follow-up: give both the gateway's policy.
- Each call carries the organization's bindings, a few hundred bytes.
- Self-hosted installs with `BLOCK_LOCAL_HTTP_CALLS=false` see no change.
- Every deployment that wants bindings in nlpgo sets one Ed25519 key pair:
  the signing key on the app, the verify key on nlpgo and in each project's
  NLP Lambda environment. `@langwatch/server` generates the pair; the Helm
  chart reads both from the app Secret.

## Known gaps

These paths do not honour bindings yet; the spec tags them `@unimplemented`.
A call on one of them to a bound host is refused and never reaches the private
endpoint:

- Azure OpenAI and Bedrock: Bifrost cannot derive a provider per endpoint for
  them, so a bound call cannot be pinned;
- the LangWatch provider, realtime (voice) sessions and Azure audio: they share
  one connection pool across tenants;
- Codex coding-agent runs and Voyage embeddings.

Vertex AI cannot use a private endpoint: its provider settings have no base
URL, so a Vertex AI call always goes to Google's own endpoint and no binding
applies to it.

nlpgo credentials carry no provenance, so nlpgo refuses `langwatch.ai`
bindings instead of skipping platform credentials as the gateway does.

langevals reaches a bound host only through nlpgo, so it needs a route to the
app's NLP service URL. The Helm chart runs langevals in the same namespace as
nlpgo with no network policy between them, so it has one. A deployment that
runs langevals where it cannot reach nlpgo (a Lambda outside the cluster, for
example) fails closed for bound calls.

## Infra follow-ups

- A code block on a project's NLP Lambda can open sockets inside the Lambda's
  subnets directly, without any binding. That is out of scope here and is
  ADR-053 Track E (isolate NLP code blocks).
- Restricting the NLP Lambda security group's egress is a deployment task.
- Give the TS app and nlpgo the AI gateway's private-egress NetworkPolicy (see
  Consequences).

## References

- ADR-053: tenant-aware egress and workload isolation (Tracks A, C and E)
- ADR-195: outbound proxy in the egress fence
- `specs/security/ssrf-blocking.feature`
- `specs/security/tenant-aware-egress-isolation.feature`
- `packages/egress/specs/egress-address-policy.feature`
