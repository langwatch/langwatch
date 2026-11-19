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
call at anything else in our network. Binding a public name such as
`api.openai.com` sends only their own calls to their own endpoint. No private
DNS zone is needed on our side.

A host that is not bound follows today's rules: public addresses pass, private
addresses are refused, and metadata addresses are always refused. An IP-literal
base URL can never be bound. Staff cannot register a metadata, loopback or
public address as a private endpoint address.

**Bindings travel with the call.** Go services get no database access for this:

- The TS app resolves the organization's bindings (hostname, addresses, port)
  and attaches them to its internal call to nlpgo (`/go/proxy/v1` and workflow
  payloads). That call is already authenticated with the internal secret.
- The AI gateway receives them in the control-plane config bundle, next to
  `Bundle.OrganizationID`.

**One policy per call, every model path.** v1 covers every place that reaches a
custom model endpoint:

- the credential check when a provider is saved;
- model discovery;
- nlpgo's playground proxy (playground and prompts);
- nlpgo workflow LLM and evaluator blocks;
- AI gateway virtual-key traffic.

Each path builds its endpoint policy from the global flags plus the call's
bindings. Bifrost gets a per-call dialer that applies the same rules, instead of
the `AllowPrivateNetwork` switch.

**Out of scope:** workflow HTTP blocks, webhooks, scenario HTTP agent targets
and code blocks. They stay on today's global policy. A binding authorizes model
calls, not arbitrary HTTP.

## Alternatives

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

## References

- ADR-053: tenant-aware egress and workload isolation (Track C)
- ADR-195: outbound proxy in the egress fence
- `specs/security/ssrf-blocking.feature`
- `specs/security/tenant-aware-egress-isolation.feature`
- `packages/egress/specs/egress-address-policy.feature`
