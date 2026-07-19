# See dev/docs/adr/053-tenant-aware-egress-and-workload-isolation.md

Feature: Tenant-aware outbound egress and untrusted workload isolation
  As a LangWatch SaaS operator
  I want tenant-selected network traffic and tenant-controlled code to cross
  explicit, tenant-bound isolation points
  So that one tenant cannot use SSRF or a shared runtime to reach platform or
  sibling-tenant resources

  Background:
    Given the hosted SaaS egress policy is fail-closed
    And every outbound request has an authenticated organization and project
    And private destinations can only be selected by registered connector ID

  Rule: Live AI gateway containment blocks non-public destinations

    @security @integration @phase-0
    Scenario Outline: The gateway rejects special-use destination classes
      Given a tenant controls a custom provider endpoint
      When the endpoint resolves to <destination>
      Then the request is denied before provider data is sent
      And the denial is audited for that tenant without credentials

      Examples:
        | destination                         |
        | 127.0.0.1                           |
        | 10.0.0.1                            |
        | 169.254.169.254                     |
        | the Kubernetes API service address  |
        | an RFC 1918 address                 |
        | an IPv6 loopback address            |
        | an IPv6 unique-local address        |
        | an IPv4-mapped private IPv6 address |

    @security @integration @phase-0
    Scenario: A DNS rebinding answer cannot change the connected address class
      Given a customer hostname resolves publicly during authorization
      And the hostname resolves privately on a later DNS query
      When the gateway dispatches the provider request
      Then the socket connects only to the authorized public address
      Or the request is denied
      And no private address receives request bytes

    @security @integration @phase-0
    Scenario: A redirect is re-authorized before it is followed
      Given an allowed public endpoint redirects to a private endpoint
      When the gateway receives the redirect
      Then the redirect is not followed
      And no private address receives request bytes

    @security @deployment @phase-0
    Scenario: Application and network controls are both effective
      Given the gateway application validator is accidentally disabled
      When a request attempts to reach a core VPC address
      Then the gateway pod network policy denies the connection
      And the rejected flow is observable

    @security @deployment @phase-0
    Scenario: The gateway has only required workload authority
      Then the gateway pod does not receive the shared Redis credential
      And the gateway pod cannot connect to Redis
      And the gateway pod does not mount a Kubernetes service-account token

  Rule: Public destinations continue to work through the egress plane

    @integration
    Scenario Outline: Supported public delivery semantics are preserved
      Given a tenant is authorized to use <egress class>
      And the destination resolves only to globally routable addresses
      When the tenant starts a request
      Then the request is delivered over TLS through the egress plane
      And timeout and request and response size limits are enforced
      And the audit event is attributed to the organization and project

      Examples:
        | egress class           |
        | automation webhook     |
        | built-in AI provider   |
        | custom public provider |

    @integration
    Scenario: AI streaming cancellation propagates across the egress hop
      Given a public provider is streaming a response
      When the client disconnects
      Then the provider connection is cancelled within the configured budget
      And the final audit event records a client cancellation

    @integration
    Scenario: Webhook retry identity survives queue redelivery
      Given a webhook delivery is retried after a transient response
      When the dedicated executor redelivers the job
      Then every attempt uses the same event and idempotency identifiers
      And only the final delivery state is folded into the process

  Rule: The egress contract is tenant-bound

    @security @integration
    Scenario: A signed envelope cannot be replayed for another tenant
      Given an envelope was issued for organization A and project A
      When it is submitted with organization B or project B credentials
      Then authorization fails
      And no outbound connection is opened

    @security @integration
    Scenario: A tenant cannot select another tenant's credential reference
      Given organization A has a provider credential
      When organization B names that credential reference
      Then authorization fails
      And the credential is not materialized

    @security @integration
    Scenario: Provider connections do not leak authentication across tenants
      Given tenants A and B use the same provider hostname
      When their requests are dispatched concurrently
      Then each request uses only its tenant-authorized credential
      And a pooled connection cannot change tenant policy or credential identity

    @security @load
    Scenario: One tenant cannot exhaust the shared egress plane
      Given tenant A continuously fills its allowed dispatch rate
      When tenant B submits an allowed request
      Then tenant B receives capacity within the service-level objective
      And tenant A is throttled by tenant and destination

  Rule: Private provider access uses registered connectors

    @security @integration
    Scenario: A tenant uses its own registered PrivateLink connector
      Given organization A owns connector A
      And connector A names exact endpoint addresses and TCP port 443
      When organization A dispatches through connector A
      Then only connector A's endpoint can be reached
      And the endpoint security group accepts only the egress workload identity

    @security @integration
    Scenario: A tenant cannot use another tenant's private connector
      Given organization A owns connector A
      When organization B requests connector A
      Then authorization fails
      And no connection to connector A is opened

    @security @integration
    Scenario: A raw private URL cannot substitute for a connector
      Given a tenant submits a private hostname in a provider base URL
      When the provider request is authorized
      Then the request is denied
      And the response directs the tenant to register a private connector

  Rule: Webhooks execute without general worker authority

    @security @deployment
    Scenario: A webhook job exposes only job-scoped data
      Given the process manager publishes a signed webhook job
      When the dedicated executor receives it
      Then the executor receives only that job's destination, body, and headers
      And it has no database, Redis, object-store, AI-provider, or platform credentials
      And it has no Kubernetes credentials

    @security @integration
    Scenario: The general worker cannot bypass the webhook executor
      Given a process worker tries to connect directly to an arbitrary public host
      Then the worker network policy denies the connection
      And legitimate webhook delivery still succeeds through the executor

  Rule: Every untrusted Langy worker has its own gVisor sandbox

    @security @deployment
    Scenario: Two conversations never share a pod sandbox
      Given conversations for tenants A and B run concurrently
      Then each conversation has a distinct worker pod
      And each pod uses runtimeClassName gvisor
      And each pod has distinct PID, mount, network, and ephemeral storage namespaces

    @security @integration
    Scenario Outline: A compromised worker cannot inspect a sibling
      Given tenant A controls arbitrary shell in its worker pod
      And tenant B has an active worker pod
      When tenant A attempts to access tenant B's <resource>
      Then access is denied
      And tenant B's data is not disclosed

      Examples:
        | resource              |
        | processes             |
        | environment variables |
        | temporary files       |
        | open file descriptors |
        | loopback services     |
        | session credentials   |

    @security @integration
    Scenario: A Langy worker cannot bypass the external egress service
      Given tenant-controlled code ignores proxy environment variables
      When it connects directly to a public address
      Then the sandbox network policy denies the connection
      And an allowed destination succeeds only through the external egress service

    @deployment
    Scenario: Selecting gVisor also selects compatible capacity
      Given a worker pod selects the gvisor RuntimeClass
      Then RuntimeClass scheduling selects the dedicated gVisor nodes
      And the pod tolerates only the dedicated gVisor taint
      And scheduler accounting includes the sandbox runtime overhead

    @resilience
    Scenario: Controller or node failure does not mix tenant state
      Given a Langy controller or gVisor node fails
      When an active conversation is resumed
      Then routing state selects a new single-tenant sandbox
      And credentials from the failed sandbox are not reused by another tenant

  Rule: Tenant Python code does not execute in the shared NLP pod

    @security @deployment
    Scenario: A code block receives an invocation-scoped sandbox
      Given a workflow contains tenant Python
      When the code block runs
      Then it executes in a per-invocation Lambda or gVisor sandbox
      And the shared NLP pod does not execute the Python process
      And only that invocation's inputs and scoped secrets are present

    @security @integration
    Scenario: A code block is denied network access by default
      Given a workflow has not declared outbound HTTP capability
      When tenant Python opens a network connection
      Then the sandbox denies the connection

    @security @integration
    Scenario: An HTTP-enabled code block uses tenant-aware egress
      Given a workflow is authorized for outbound HTTP
      When tenant Python calls an allowed public destination
      Then the connection passes through the tenant-aware egress service
      And private and sibling-tenant destinations remain denied

  Rule: Production cannot silently drift open

    @security @deployment
    Scenario: Security-critical drift blocks a release
      Given desired infrastructure requires fail-closed endpoint validation
      When the live deployment omits a required environment variable or policy
      Or it omits the token setting, RuntimeClass, or workload identity
      Then the deployment verification fails
      And the release does not report success

    @security @deployment
    Scenario: Every selected pod has an enforced policy endpoint
      Given a NetworkPolicy selects a gateway, egress, NLP, or sandbox pod
      When deployment verification runs
      Then an enforced policy endpoint exists for every selected pod
      And a negative connectivity probe confirms the denied paths
