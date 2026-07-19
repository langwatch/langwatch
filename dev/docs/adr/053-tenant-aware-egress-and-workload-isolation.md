# ADR-053: Tenant-aware egress and per-workload sandbox isolation

**Date:** 2026-07-19

**Status:** Proposed

> Behavioural contract: [tenant-aware-egress-isolation.feature](../../../specs/security/tenant-aware-egress-isolation.feature)
>
> This ADR records the target architecture and phased delivery plan. It does
> not authorize applying production changes without a separately reviewed
> rollout and rollback procedure.

## Context

LangWatch accepts tenant-controlled destinations or executes tenant-controlled
work at several outbound boundaries:

1. Automation webhooks are dispatched by the shared TypeScript worker fleet.
2. The AI gateway calls provider and customer-configured model endpoints.
3. The NLP service calls providers in process and executes workflow code blocks
   as Python subprocesses.
4. Langy runs LLM-directed shell and network activity in a gVisor pod.

These paths need public Internet access, and some customers legitimately need
private provider connectivity. URL validation alone cannot establish the
boundary: DNS can change between validation and connection, redirects can
cross address classes, and a future call site can omit the validator. More
importantly, a shared process or pod can hold credentials and state for several
tenants, so a single escape or SSRF bypass inherits the whole pod's authority.

### Production observation on 2026-07-19

Read-only inspection of the production EKS cluster found material drift from
the infrastructure repository:

- The AI gateway runs as three ordinary runc pods on the primary node group.
  BLOCK_LOCAL_HTTP_CALLS and REQUIRE_HTTPS_CUSTOM_ENDPOINTS are absent from the
  live deployment, so the service's permissive defaults apply.
- No NetworkPolicy selects the live gateway, worker, or NLP pods. The VPC CNI
  network-policy agent is enabled, but only the Langy policy is present in the
  default namespace.
- The live gateway receives the shared Redis credential and mounts the default
  service-account token even though neither authority is needed for provider
  dispatch.
- The main infrastructure branch contains gateway environment hardening and a
  NetworkPolicy, but that configuration is not deployed. It must not be applied
  blindly: its Bedrock rule targets the protected subnets while the endpoints
  are in the PrivateLink subnets, and its Redis rule preserves an unnecessary
  gateway-to-core dependency.
- The NLP pod is an ordinary shared container with unrestricted egress. It
  executes tenant Python code as same-UID subprocesses and passes decrypted
  project secrets in the request. Processes share the container PID, mount,
  temporary-file, and network namespaces.
- Langy runs one manager and up to twenty untrusted workers in a single gVisor
  pod on a dedicated, tainted node. Per-worker Unix users and passwords improve
  separation inside that pod, but all workers share one gVisor sandbox and one
  network namespace. The production egress policy allows globally routable
  TCP/443, and LANGY_EGRESS_ENFORCE_FLOOR is false.

### Application observations

The automation webhook sender already forces private-address blocking, refuses
redirects, pins the validated DNS answer for the connection, caps response
size, applies timeouts, sanitizes headers, and rate-limits per project. Its
principal remaining risk is execution inside the general worker pod, which
also holds database, Redis, object-store, provider, and platform credentials.

The Go customer-endpoint validator rejects non-public DNS answers when its
policy is enabled, but validation returns only an error. The provider client
subsequently resolves the hostname again. A DNS-rebinding attacker can
therefore present a public address during validation and a private address
during connection. The same provider adapter is embedded by the NLP service,
so protecting only the public gateway deployment does not close this path.

Managed private provider endpoints are represented partly as tenant-supplied
URLs. A hostname suffix establishes neither tenant ownership nor authorization
to a particular PrivateLink endpoint.

### Threat model

The design assumes:

- a tenant may fully control a webhook URL, custom provider URL, DNS zone,
  redirect response, workflow code block, or text that prompt-injects Langy;
- one tenant must not reach another tenant's credentials, files, processes,
  sessions, provider connection, or private endpoint;
- public destinations may be malicious, change DNS answers, use unusual ports,
  stream indefinitely, or return oversized responses;
- application validation can regress and must be backed by a network invariant;
- a compromised egress workload must not reach Kubernetes, instance metadata,
  VPC data stores, the control plane, or unrelated services;
- self-hosted installations may deliberately permit private destinations, but
  SaaS is fail-closed.

## Decision

We will build a tenant-aware outbound egress plane and make it the only network
path for tenant-selected destinations. We will separate trusted orchestration
from untrusted execution, and give each untrusted Langy or code-block execution
its own sandbox.

The plan has an immediate containment phase followed by four migration tracks.

## Target topology

### Current production shape

The important problem is not only that several services can open sockets. It is
that tenant-controlled work and broad platform authority occupy the same
workloads and network domain.

    tenant URL / prompt / Python / DNS
                    |
                    v
    +---------------------------------------------------------------+
    | core EKS VPC                                                  |
    |                                                               |
    |  [general workers] ---- direct webhook ---> Internet          |
    |       | DB, Redis, S3, provider/platform secrets              |
    |                                                               |
    |  [AI gateway] ------- direct provider ---> Internet / VPC     |
    |       | shared Redis credential, default service-account token |
    |                                                               |
    |  [NLP pod] ---------- direct provider ---> Internet / VPC     |
    |       +-- tenant Python subprocess A                          |
    |       +-- tenant Python subprocess B                          |
    |                                                               |
    |  [one gVisor Langy pod]                                       |
    |       +-- manager + worker A + worker B ... share a sandbox   |
    +---------------------------------------------------------------+

The application webhook sender has a strong URL-level fence. The gateway and
NLP paths do not currently have an equivalent enforced network boundary in
production. The Langy worker identity is better than a shared Unix account, but
it is still a sibling process boundary inside one sandbox.

### Target SaaS shape

The final design has three different trust zones. A message crossing from one
zone to another carries only the authority required for that hop.

    +------------------------ core application plane ------------------------+
    |                                                                           |
    |  client --> [AI gateway frontend] ---- mTLS / signed envelope ---+      |
    |                                                                   |      |
    |  process manager --> [outbox] --> [durable queue] --> [webhook   |      |
    |                                                   executor] ------+      |
    |                                                                   |      |
    |  [NLP orchestrator] --> [one code sandbox per invocation]       |      |
    |  [Langy controller] --> [one gVisor pod per conversation]       |      |
    |                         |                                         |      |
    |                         +-- no direct Internet egress             |      |
    +-------------------------|-----------------------------------------|------+
                              | PrivateLink / narrow mTLS API          |
                              v                                         v
    +----------------------------- egress plane -----------------------------+
    |                                                                           |
    |   [tenant-aware egress service]                                          |
    |       | verify tenant, policy, connector, budget, and signature          |
    |       | resolve once, validate all answers, pin socket to approved IP    |
    |       | audit decision and connection metadata                           |
    |       +--------------------+-------------------------------+             |
    +----------------------------|-------------------------------|-------------+
                                 |                               |
                            public TLS                       registered private
                                 |                               |
                                 v                               v
                         [AI providers /               [tenant-owned PrivateLink
                          webhook targets]              endpoint + scoped SG]

    Hard invariant: sandbox, worker, gateway frontend, and NLP pods cannot
    directly reach public providers, arbitrary webhook targets, core VPC
    addresses, Kubernetes services, or instance metadata. Only the egress
    service can make the final destination connection.

### Network placement

    Internet
       |
     [NLB]
       |
    gateway frontend pods                 core application VPC / cluster
       |                                     |
       +-- only control-plane, telemetry, ---+-- no arbitrary egress
       |   and egress-service access
       |
       +==== PrivateLink or equivalent mTLS boundary ====+
                                                         |
                                      separate egress VPC / cluster
                                                         |
                                             egress service + dedicated NAT
                                                         |
                                             public providers / connector ENIs

The gateway frontends have dedicated pod subnets, security groups, and a node
group during the transition. The final socket-owning egress service is placed
in the separate egress VPC or equivalent network domain with no route or
peering to the core VPC. A subnet name alone is not a security boundary.

### Phase 0: contain the live SSRF path

This is an emergency production change, delivered and verified independently
of the larger migration:

1. Set BLOCK_LOCAL_HTTP_CALLS=true and
   REQUIRE_HTTPS_CUSTOM_ENDPOINTS=true on the AI gateway, then verify the
   effective environment in the live ReplicaSet.
2. Apply a corrected default-deny gateway NetworkPolicy. Permit only cluster
   DNS, the signed control-plane endpoint, internal telemetry, exact approved
   PrivateLink endpoint addresses on TCP/443, and globally routable provider
   destinations on the required TLS ports. Explicitly exclude all private,
   loopback, link-local, metadata, pod, node, service, multicast, documentation,
   benchmark, and reserved ranges for both IPv4 and IPv6.
3. Remove GATEWAY_REDIS_URL, Redis network access, and the service-account token
   from the gateway. Set automountServiceAccountToken=false and use a dedicated
   service account with no Kubernetes RBAC if an identity object is required.
4. Add a default-deny policy to the NLP service before leaving custom provider
   endpoints enabled there. If a safe policy cannot be deployed in the same
   window, temporarily disable custom endpoints on the in-process NLP path.
5. Canary with synthetic public-provider, private-address, metadata, redirect,
   and DNS-rebinding probes. Confirm a PolicyEndpoint exists for every selected
   pod and inspect rejected-flow telemetry before completing rollout.

Rollback may restore a known public provider destination, but must not restore
private-address access or the unused Redis credential. Any customer requiring a
private endpoint uses an explicitly registered connector, not a global switch.

### Track A: a common tenant-aware egress contract

Every outbound job carries a signed, minimal envelope:

- organization and project identifiers;
- request and idempotency identifiers;
- destination class: public webhook, public provider, or registered private
  connector;
- normalized destination and allowed port;
- an opaque credential reference or per-job encrypted headers, never the
  platform's general secret set;
- policy version, timeout, maximum request/response bytes, and retry budget.

The egress plane verifies the signature and authorizes organization, project,
destination class, and credential reference together. Queue partitions,
connection pools, rate limits, circuit breakers, and logs are keyed by tenant
and destination. A connection authenticated for one tenant is never reused for
another tenant unless the upstream credential and policy identity are exactly
the same and the sharing is an explicit server-side policy.

For every attempt the plane records tenant identifiers, request ID, normalized
host, resolved address, destination class, policy version, decision, byte
counts, status class, latency, and retry outcome. It does not log credentials,
authorization headers, request bodies, or URL query values.

### Track B: remove webhook delivery from the general worker

The process manager continues to decide that a webhook should fire, render its
payload, and persist an outbox intent. A dedicated webhook egress executor
consumes a durable, signed envelope and performs delivery.

The executor:

- has no database, Redis, object-store, Kubernetes, AI-provider, or platform
  credentials;
- receives only the one job's destination, body, and encrypted headers;
- retains the current pinned-DNS, no-redirect, timeout, size-cap, header
  sanitization, retry, and idempotency semantics;
- enforces per-project and per-destination fairness so one tenant cannot consume
  the fleet;
- emits a result event that the process manager folds into delivery state.

SQS is the preferred SaaS transport because it separates IAM authority and
provides durable retry/dead-letter semantics. The existing outbox remains the
transactional source of truth; publishing is idempotent.

### Track C: isolate AI provider egress

The public AI gateway remains responsible for authentication, virtual-key
authorization, request shaping, and streaming responses. It does not directly
dial tenant-selected destinations. It calls a private, mutually authenticated
egress service with the signed envelope.

The gateway frontends run on a dedicated node group and pod subnets with a
workload security group that permits only the control plane, telemetry, and
egress service. This makes their address and workload identity explicit while
the policies, rather than the subnet name, provide the actual isolation.

For public providers, the egress service resolves and validates every DNS
answer, selects an allowed address, and binds the socket dial to that exact
address while preserving the original hostname for TLS SNI and certificate
verification. Redirects are disabled or re-authorized hop by hop. Scheme,
port, duration, headers, and body sizes are bounded.

Private connectivity is an operator-created connector:

- the control plane stores an immutable connector ID bound to an organization
  and optional project;
- the connector specifies exact PrivateLink endpoint IDs or addresses, ports,
  provider type, region, and credential role;
- tenant requests refer to connector_id, never a raw private URL;
- the egress service verifies connector ownership on every request;
- endpoint security groups admit only the egress workload identity, not the
  whole VPC.

In SaaS the egress workloads will run in a dedicated egress VPC or equivalent
network domain with no route or peering to the core VPC. Narrow PrivateLink
services expose only the control-plane and telemetry APIs it needs. Each egress
class uses dedicated NAT addresses for attribution and provider allow-listing.

If a separate VPC cannot be delivered initially, the transitional boundary is
a dedicated node group plus pod subnets, Security Groups for Pods, and
default-deny NetworkPolicy. A subnet alone is not accepted as isolation because
the VPC local route still connects it to the rest of the VPC. The transitional
design must explicitly deny core VPC and cluster ranges.

All provider dispatch from NLP is moved behind the same gateway/egress service.
The in-process provider adapter is retired for SaaS so it cannot become a
second, less-protected egress plane.

### Track D: one gVisor sandbox per untrusted workload

The Langy manager becomes a trusted controller in a separate pod. Each
conversation worker runs in its own short-lived pod with runtimeClassName
gvisor. There is no useful nested gVisor topology: RuntimeClass selects a pod
sandbox, and different customer workloads require different sandboxes.

Each worker pod has:

- a unique conversation and tenant identity;
- a read-only root filesystem and writable ephemeral workspace;
- no service-account token, host mounts, privileged mode, or broad Linux
  capabilities;
- only session-scoped LangWatch, gateway, and GitHub credentials;
- a default-deny ingress and egress policy;
- egress only to the external egress service and the minimal authenticated
  internal APIs required for that session.

The forward proxy moves out of the worker pod. NetworkPolicy denies direct
Internet access from the sandbox, making the L7 policy mandatory rather than
cooperative. A warm pool of empty sandbox pods controls startup latency.
Conversation ownership and routing live outside the controller process so the
controller and gVisor node group can have multiple replicas across zones.

The gVisor RuntimeClass will include scheduling.nodeSelector, tolerations, and
resource overhead. This makes selection of gVisor also select compatible,
tainted nodes instead of relying on every workload manifest to duplicate the
placement rules.

### Track E: isolate NLP code blocks

Tenant Python is removed from the shared NLP container. SaaS code blocks run in
the existing per-project Lambda boundary or in one short-lived gVisor pod per
invocation. The shared NLP service performs trusted orchestration only.

The sandbox receives a single invocation's inputs and scoped secrets through an
authenticated channel, has no shared writable volume or process namespace, and
returns a bounded result. Its network is denied by default and, when the
workflow explicitly permits HTTP, uses the same tenant-aware egress service.

The internal NLP endpoint also gains workload authentication and an ingress
policy restricted to its legitimate callers. The /dev/kvm host mount is removed
unless a reviewed runtime dependency demonstrates it is necessary.

## Delivery sequence

The phases are intentionally ordered so that each stage reduces risk on its own:

| Phase | Application repository | Infrastructure repository | Exit gate |
|---|---|---|---|
| 0. Emergency containment | Fail-closed gateway config tests and rebind regression tests | Live flags, corrected gateway/NLP policies, token and Redis removal | Private, metadata, redirect, and rebind probes fail closed in production |
| 1. Shared contract | Egress envelope, policy evaluator, audit schema, pinned Go dialer | Egress namespace, identities, queues, dashboards | Both TS and Go conformance suites pass |
| 2. Webhooks | Outbox publisher and dedicated executor | Queue, isolated deployment, no-secret identity, deny policies | General workers cannot reach arbitrary Internet destinations |
| 3. Providers | Gateway-to-egress transport, connector authorization, retire NLP in-process dial | Dedicated egress network, NAT, PrivateLink connector security groups | Gateway/NLP cannot dial providers directly |
| 4. Langy | Controller/worker protocol, externalized routing, warm-pool lifecycle | Per-worker gVisor pods, RuntimeClass scheduling, forced proxy policy, multi-node group | Two simultaneous tenants cannot share sandbox resources |
| 5. Code blocks | Remote sandbox executor, bounded result protocol | Per-invocation Lambda or gVisor runtime | No tenant code executes in the shared NLP pod |
| 6. Enforcement | Remove legacy direct-dial feature flags and code | Delete transitional broad egress paths and stale secrets | Bypass tests and flow-log assertions remain green |

Every phase ships with a canary, explicit rollback, dashboards, and a
post-deployment comparison of desired Terraform state to live Kubernetes state.
Drift detection for security-critical environment variables, NetworkPolicies,
service-account automounting, and RuntimeClass is a release gate.

## Detailed implementation plan

### Workstream 0: emergency containment and evidence preservation

**Goal:** close the currently live gateway SSRF path without waiting for the
new egress service.

**Infrastructure changes**

1. Reconcile the live AI gateway Deployment with infrastructure/gateway.tf:
   add BLOCK_LOCAL_HTTP_CALLS=true, REQUIRE_HTTPS_CUSTOM_ENDPOINTS=true, and
   ENVIRONMENT; set automountServiceAccountToken=false; and remove
   GATEWAY_REDIS_URL.
2. Replace the gateway NetworkPolicy with a deny-by-default policy generated
   from the real destination inventory. It permits:
   - CoreDNS UDP and TCP on port 53.
   - The signed control-plane service on its one port.
   - The named OpenTelemetry collector on its one port.
   - Exact managed PrivateLink endpoint ENI addresses on TCP/443.
   - Globally routable public destinations on the explicit supported TLS port
     set during the containment period.
3. Do not retain a VPC-wide Redis port rule. If a later gateway feature needs
   Redis, give that feature a dedicated credential, security group, endpoint,
   and a separately reviewed policy.
4. Add an equivalent default-deny policy to the NLP pod. Its only temporary
   egress routes are DNS, its authenticated control-plane caller, telemetry,
   and the gateway/egress endpoint. Remove its /dev/kvm host mount unless the
   migration owner records a concrete dependency and a compensating control.
5. Inventory every selected pod after deployment. Kubernetes PolicyEndpoint
   objects, CNI enforcement state, and negative connectivity probes are all
   required; the presence of a NetworkPolicy YAML object is not enough.

**Application changes**

1. In services/aigateway/config.go, make a hosted production configuration
   fail startup if the two endpoint-hardening flags are missing or false.
   Self-hosted permissive behavior remains explicit and separately documented.
2. In services/aigateway/adapters/providers/customer_endpoint_ssrf.go and
   bifrost.go, replace validate-then-redial behavior with a resolved endpoint
   value that the HTTP transport must use. Preserve the logical hostname for
   HTTP Host and TLS SNI/certificate checks while dialing the authorized IP.
3. Add DNS-rebinding, metadata IPv4/IPv6, IPv4-mapped IPv6, redirect, custom
   port, and mixed-answer tests to customer_endpoint_ssrf_test.go and the
   integration harness.
4. Add a release smoke command that exercises a controlled public provider,
   a denied private target, and a denied DNS-rebinding target from a gateway
   pod in the canary ReplicaSet.

**Rollout and rollback**

    deploy policy in observe/canary scope
                |
                v
    verify allowed provider + control-plane + telemetry traffic
                |
                v
    enable fail-closed gateway flags on one replica
                |
                v
    run negative probes and inspect rejected-flow metrics
                |
                v
    expand to all replicas, then remove unnecessary credentials

If an unexpected legitimate destination is denied, add only the exact
destination class supported by the policy model, rerun the probe suite, and
continue. Do not restore VPC-wide access or disable the flags. The rollback
unit is a narrowly scoped provider or connector rule.

**Exit evidence**

- The live pod specification contains both endpoint flags and no projected
  service-account token.
- A tenant cannot reach loopback, private, metadata, service, pod, node, or
  DNS-rebinding targets from the gateway or NLP path.
- The gateway cannot connect to Redis.
- Every selected pod has an enforced policy endpoint and observable denies.

### Workstream 1: egress contract, policy engine, and observability

**Goal:** create the common contract before migrating callers so no new
special-case outbound path appears.

**Application design**

1. Define an EgressRequest envelope shared by TypeScript and Go. It contains
   version, request ID, organization ID, project ID, caller class, destination
   class, normalized authority, port, credential reference, timeout, byte
   limits, retry budget, and policy version.
2. Sign the envelope with a workload-specific key or short-lived workload
   identity. The egress service rejects an unsigned envelope, expired envelope,
   replayed request ID, mismatched tenant claim, or a destination that differs
   from the signed normalized authority.
3. Build a policy evaluator with exactly three destination modes:
   public-webhook, public-provider, and private-connector. Raw private IPs,
   RFC1918 DNS answers, local hostnames, and private URL schemes are never a
   fourth mode.
4. Build a resolver-and-dialer library that returns the permitted address and
   dials it directly. All redirects are disabled by default; a product
   requirement for redirects must create a fresh signed authorization for every
   hop.
5. Define connection-pool keys as tenant policy identity plus credential
   reference plus normalized authority. This prevents an authenticated
   connection or CONNECT tunnel from silently crossing tenant policy.
6. Emit an immutable egress decision event before opening the connection and a
   completion event afterwards. Redact headers, body, credentials, and query
   strings at the event boundary rather than relying on every log call.

**Repository seams**

- Application: add a dedicated egress domain package beside services/aigateway
  dispatcher code; migrate services/aigateway/adapters/providers/bifrost.go to
  the client interface; reuse, but do not duplicate, the resolution semantics
  in langwatch/src/utils/ssrfProtection.ts.
- Infrastructure: introduce a dedicated egress namespace, service account,
  workload security group, KMS key, queue identities, dashboards, alerts, and
  VPC flow logs. Keep these resources outside the general worker identity.

**Exit evidence**

- TypeScript and Go share conformance vectors for every address class and DNS
  sequence.
- An invalid envelope cannot open a socket.
- Logs explain who attempted which destination class without exposing secrets.
- Connection reuse tests prove isolation across organizations and credentials.

### Workstream 2: move webhook delivery to an isolated executor

**Goal:** retain existing webhook behavior while taking arbitrary Internet
delivery away from the privileged process worker.

**Implementation steps**

1. Keep ProcessOutboxWorker as the transactional owner of an automation
   delivery intent. It renders the payload and writes a signed egress job; it
   no longer calls sendWebhook.ts directly in SaaS.
2. Create a webhook-delivery worker with a minimal image and identity. It
   receives a single queue message, decrypts only the job's headers, invokes
   the egress service, and writes a compact delivery result event.
3. Preserve the semantics in the existing sendWebhook.ts and
   httpDestination.ts tests: no redirects, pinned DNS, reserved-header
   stripping, response cap, timeout, stable event ID, project quota, retry
   classification, and dead-letter behavior.
4. Add queue visibility timeout and idempotency handling so a crash between
   send and result publication causes a safe retry rather than two unrelated
   deliveries.
5. Partition rate limits and queue concurrency by project and destination so
   one abusive webhook cannot starve other tenants.
6. After successful migration, deny public Internet egress from the general
   worker deployment. It continues to reach only its databases, queues, and
   internal services.

**Cutover**

    automation trigger
           |
           v
    process outbox (existing durable intent)
           |
           +-- feature flag: legacy direct sender OR signed queue publisher
                                                    |
                                                    v
                                           isolated webhook executor
                                                    |
                                                    v
                                              egress service

Run both paths only for shadow telemetry where a duplicate request is
impossible; do not shadow-deliver a customer webhook. The operational cutover
uses a project allow-list, then a percentage rollout, then legacy sender
removal.

**Exit evidence**

- General worker network probes cannot reach a public webhook receiver.
- The executor has no broad platform secret set.
- Retried webhook deliveries retain the existing event ID and result semantics.

### Workstream 3: provider egress and private connectors

**Goal:** make the provider request path tenant-bound from virtual-key
authorization through socket creation.

**Implementation steps**

1. Place the public AI gateway frontend on dedicated capacity with a restrictive
   security group and NetworkPolicy. It can reach only the control plane,
   telemetry, and egress API.
2. Implement the egress API as a streaming-capable internal protocol. It must
   propagate cancellation, response headers, status, and bounded streaming data
   without buffering an entire model response.
3. Replace direct Bifrost HTTP dispatch with the egress client. Retire the
   embedded provider path in NLP or force it through the same client.
4. Create a PrivateProviderConnector control-plane resource. It stores owner
   organization, optional project, endpoint identifiers, provider protocol,
   approved port, region, role/credential reference, status, and audit fields.
5. Change managed Bedrock and equivalent private-provider requests to carry
   connector ID. Reject URL-based access to a private endpoint even if its
   suffix resembles a cloud provider domain.
6. Restrict each PrivateLink endpoint security group to the egress workload
   security group. Do not admit the whole VPC CIDR.
7. Allocate dedicated NAT gateways or egress addresses per environment and
   record address-to-tenant attribution in egress logs. Provider allow-list
   requests use these stable addresses where supported.

**Migration**

- Discover existing managed endpoint configurations and classify each as public
  provider, internal connector candidate, or unsupported.
- Create connector records and endpoint rules before changing any request path.
- Dual-read URL and connector configuration only long enough to migrate; only
  connector IDs may authorize private traffic after the deadline.
- Canary by organization and provider type, with streaming and tool-call
  scenarios included.

**Exit evidence**

- Gateway and NLP workloads fail a direct provider connection probe.
- A tenant cannot use another organization's connector or credential reference.
- Public streaming and known provider integrations meet the baseline latency and
  cancellation budgets.

### Workstream 4: per-workload Langy and code-block sandboxes

**Goal:** turn the current shared-process boundaries into actual tenant
isolation boundaries.

**Langy implementation steps**

1. Extract session lifecycle, queueing, and credential minting from the
   langy-agent manager into a trusted controller deployment.
2. Add a WorkerSandbox custom resource or controller-owned job definition
   containing only conversation identity, image version, resource budget,
   policy version, and short-lived credential references.
3. Launch one runtimeClassName gvisor pod per conversation. The pod receives no
   service-account token, hostPath, privileged capability, or reusable tenant
   workspace.
4. Move node selector, taint toleration, and runtime overhead into
   infrastructure/langy_gvisor.tf RuntimeClass scheduling. Scale the dedicated
   node group across at least two zones and make pod/IP capacity part of
   autoscaling calculations.
5. Replace in-pod proxy enforcement with a distinct egress service. The worker
   NetworkPolicy allows DNS only if the egress protocol requires it; otherwise
   it allows only fixed internal endpoints and the proxy/egress service.
6. Add a warm-pool controller for empty gVisor pods. Bind credentials only after
   assignment, erase workspace on release, and never return a pod to the pool
   with tenant state attached.

**NLP code-block implementation steps**

1. Disable the shared subprocess executor in
   services/nlpgo/app/engine/blocks/codeblock for hosted execution.
2. Reuse the existing per-project Lambda path where it meets resource and
   networking requirements; otherwise submit a per-invocation gVisor sandbox
   job using the same sandbox lifecycle pattern as Langy.
3. Pass inputs and scoped secrets over an authenticated invocation channel.
   Store results in an invocation-specific object or response channel with
   strict size and timeout limits.
4. Default all code-block networking to deny. An explicitly granted HTTP
   capability calls the egress service and is subject to the same tenant policy.
5. Add internal authentication and ingress policy to NLP before it becomes a
   pure orchestrator.

**Exit evidence**

- Two simultaneous Langy conversations have different pod UIDs and cannot see
  one another's processes, files, loopback ports, or credentials.
- A prompt-injected worker cannot bypass the egress service by ignoring proxy
  variables or dialing an IP address directly.
- Tenant Python no longer starts in the shared NLP pod.

### Workstream 5: operational controls, migration governance, and deletion

**Goal:** prevent a secure design from drifting back to an open one.

1. Add CI checks that compare Terraform-selected security-critical workload
   properties with the rendered manifests: environment flags, service-account
   automounting, RuntimeClass, NetworkPolicy selection, security context, and
   security-group attachment.
2. Add a post-apply verifier that queries the cluster and rejects a release if
   any selected workload lacks a policy endpoint, expected identity, or
   deny-probe result.
3. Build dashboards for egress allow and deny rate by destination class,
   organization, project, connector, policy version, and workload. Alert on
   metadata/private denies, resolver mismatch, envelope verification failures,
   cross-tenant credential errors, unexpected direct egress, and sandbox
   creation failures.
4. Write incident runbooks for a provider outage, a connector misconfiguration,
   a suspected DNS-rebinding attack, a noisy tenant, and a failed sandbox node.
5. Maintain a capability inventory. Adding a new tenant-controlled outbound
   feature requires an egress-class decision, an envelope schema review, test
   vectors, network-policy rule, and owner before it may reach production.
6. Delete superseded code and policies after each cutover: direct Bifrost
   transport, direct worker webhook egress, broad Langy TCP/443, shared NLP
   subprocess execution, unused Redis gateway wiring, and compatibility flags.

## Dependencies and decisions to resolve before implementation

| Decision | Recommended default | Why it matters | Deadline |
|---|---|---|---|
| Egress isolation domain | Separate egress VPC or cluster | It removes a route to core workloads rather than relying on a shared-cluster policy alone | Before Workstream 3 |
| Egress transport | Streaming internal HTTP/2 or gRPC with mTLS | Provider responses and cancellations must be forwarded safely | Before Workstream 1 |
| Durable webhook transport | SQS plus existing transactional outbox | Separates worker authority and has native retry/dead-letter behavior | Before Workstream 2 |
| Sandbox runtime | gVisor pod per Langy conversation and code invocation where Lambda is unsuitable | RuntimeClass isolates a pod, not sibling processes | Before Workstream 4 |
| Private endpoint model | Tenant-bound connector IDs | Prevents hostname suffixes from becoming authorization | Before Workstream 3 |
| Hosted compatibility policy | SaaS always fail-closed; self-hosted opts into private egress deliberately | Avoids making SaaS safety depend on a permissive legacy default | Before Workstream 0 |

## Milestones, ownership, and readiness gates

| Milestone | Primary owner | Supporting owner | Production gate |
|---|---|---|---|
| M0: gateway and NLP containment | Platform/SRE | AI gateway | Live negative SSRF probes pass and policies are enforced |
| M1: egress protocol and audit contract | AI gateway | Platform/Security | Cross-language conformance and signed-envelope tests pass |
| M2: webhook executor | Application/process manager | Platform | General worker direct Internet probe is denied |
| M3: provider egress and connectors | AI gateway | Cloud networking | Gateway/NLP direct dial probe is denied |
| M4: Langy worker pods | Langy | Platform/Security | Cross-pod isolation and direct-egress bypass tests pass |
| M5: code-block sandbox migration | NLP/workflows | Platform | Shared NLP subprocess execution is absent in hosted deployment |
| M6: legacy deletion and drift gate | Platform/Security | All owners | No compatibility broad-egress rule or unused secret remains |

## Alternatives considered

### Application URL validation only

Rejected. It is vulnerable to omissions and validation/dial time-of-check to
time-of-use errors, and it does not reduce the credentials exposed after a
process compromise.

### NetworkPolicy in the current shared cluster only

Accepted for emergency containment, rejected as the final boundary.
NetworkPolicy is L3/L4, shared workloads still aggregate tenant authority, and
the core VPC local route creates a large blast radius if policy is absent or
misconfigured.

### A dedicated subnet in the current VPC

Rejected as a complete solution. It improves address management and makes
security groups easier to reason about, but all VPC route tables contain a
local route. It must be combined with pod identity, security groups, policy,
and preferably separation into a VPC without core routes.

### Per-user Unix accounts inside one Langy gVisor pod

Rejected as the tenant boundary. It remains useful defense in depth, but gVisor
isolates a sandbox from the host; it does not make sibling processes inside one
sandbox separate tenants.

### One pod containing nested sandboxed workers

Rejected. Kubernetes RuntimeClass applies at the pod sandbox boundary. One
gVisor pod per untrusted worker is simpler, supported, independently scheduled,
and gives each worker its own network and mount namespaces.

## Consequences

Positive consequences:

- SSRF safety is enforced at both application and network layers.
- Tenant identity follows a request to its actual socket and audit event.
- A bypass or compromise exposes one job or sandbox instead of shared platform
  credentials and sibling tenant state.
- Private model endpoints become explicit, tenant-bound resources.
- Langy proxy policy becomes mandatory because direct sandbox egress is denied.

Costs and constraints:

- Webhooks and provider streaming gain an extra hop and need backpressure,
  cancellation, and end-to-end latency budgets.
- The egress service, queues, warm pools, connector lifecycle, and multi-zone
  sandbox capacity add operational complexity.
- Existing raw private provider URLs require a migration to connector IDs.
- Per-worker pods consume more pod IPs and require capacity planning.
- Self-hosted deployments need a documented permissive mode, while SaaS
  configuration and tests must remain fail-closed.

## References

- Related ADRs: ADR-033, ADR-040, ADR-043, ADR-052
- On acceptance, this ADR supersedes ADR-033 and ADR-043 where they retain
  multiple untrusted workers or a cooperative proxy inside one Langy pod.
- Behavioural specification:
  specs/security/tenant-aware-egress-isolation.feature
- AWS EKS NetworkPolicy:
  https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy.html
- AWS Security Groups for Pods:
  https://docs.aws.amazon.com/eks/latest/best-practices/sgpp.html
- AWS VPC route tables:
  https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
- Kubernetes RuntimeClass:
  https://kubernetes.io/docs/concepts/containers/runtime-class/
- gVisor Kubernetes quick start:
  https://gvisor.dev/docs/user_guide/quick_start/kubernetes/
- gVisor security model:
  https://gvisor.dev/docs/architecture_guide/security/
