Feature: The standalone API process has an executable start
  As an operator running a LangWatch API deployment
  I want one start command that boots the API process from its environment
  So that the tier can be deployed without the platform application composing
  it, and refuses to start rather than serving half a graph

  # WHY THIS EXISTS
  #
  # `apps/api` had every part of a physical process — validated configuration,
  # a boot-failure boundary, a readiness gate, a listener, signal policy, a
  # bounded drain — and one thing wrong with the wiring between them: the
  # composition the entry file reached for short-circuited before any of the
  # self-composition ran.
  #
  # `ApiStandaloneComposition` was written when `ApiProductionComposition`
  # could only be handed a host's already-composed product services. Without
  # them it built a SECOND, smaller graph: a database, a queue, a health route
  # and nothing else. Every entry that has since closed —
  # the stored-secret cipher, AuthZ over the process's own producer-only
  # Eventing, the organization/project/API-key trio, the agent service, the
  # Auth service — is composed by the production composition and by nothing
  # else, so the one graph the executable actually booted could never reach
  # any of it. A deployment with a database, a Redis and a Better Auth
  # transport would still have served a health route and no product traffic,
  # and nothing in the process would have said why.
  #
  # The fix is not a new graph. It is that the executable composes the
  # production one unconditionally and lets it degrade, which is what it
  # already knows how to do: it names each collaborator it could not build and
  # falls back to the lifecycle surface. A host's product services stay
  # supported as an OVERRIDE of what the process would compose, rather than as
  # the gate that decides which graph exists.
  #
  # What this process still cannot compose is one thing, and the boot says so
  # every time: the deployment's Better Auth browser-session transport. Every
  # product route a person reaches resolves their session, and a second Better
  # Auth instance built here from a different option set would not fail — it
  # would answer "signed out" to everybody.

  Rule: One start command boots one composition

    @integration
    Scenario: The start command boots the production composition
      Given a deployment that supplies no product service adapters
      When the API executable starts
      Then it composes the production graph over its own configuration
      And it composes no second, smaller graph of its own
      # The distinction is the whole point of this spec: the production
      # composition is the only one that reaches the secret cipher, AuthZ,
      # tenancy, agents and Auth this package now builds for itself.

    @integration
    Scenario: The started process answers its health route
      Given the API executable started
      When a caller requests its health route
      Then the response is successful and carries no body

  Rule: Configuration is refused before a socket is opened

    @integration
    Scenario: A misconfigured value refuses the boot and names the leaf
      Given a deployment whose environment carries an invalid configuration value
      When the API executable starts
      Then the boot fails and the report names the configuration leaf that was wrong

    @integration
    Scenario: A refused boot leaves the configured port free
      Given a deployment whose environment carries an invalid configuration value
      When the API executable starts
      Then nothing is listening on the port that deployment configured
      # Ordering, not tidiness: a process that opened its socket and then
      # discovered its configuration was wrong has already told an
      # orchestrator it is healthy.

    @integration
    Scenario: A failed boot is reported on the process's error stream
      Given a deployment whose environment carries an invalid configuration value
      When the API executable starts
      Then the failure is written where the operator reads it, with its message first
      And the start refuses rather than resolving, so the entry file exits non-zero

  Rule: A process that cannot serve product traffic says what it is missing

  Rule: A process missing a store it needs refuses to boot

    # No host injects collaborators and no boot line announces an absent one:
    # a missing DATABASE_URL or REDIS_URL refuses the boot, naming the setting
    # (typed-process-supply.feature, "A store a module needs ..." and "A queue
    # a module needs ..."), and a missing peer module refuses by name
    # (declarative-process-composition.feature).

  Rule: Traffic is admitted only once the process is ready

    @unit
    Scenario: Readiness answers 503 until the process is ready
      Given a process whose modules are still booting or whose opened stores do not answer
      When the kubelet asks /readyz
      Then it answers 503 while /healthz answers 200
      And /readyz answers 200 once boot finished and the stores answer

  Rule: The executable owns its process couplings through one seam

    @integration
    Scenario: Shutdown drains intake, then feature work, then infrastructure
      Given the API executable started
      When it is closed
      Then intake stops first, then feature work drains, then the process graph closes

    @integration
    Scenario: The signal handlers the executable installed are removed when it closes
      Given the API executable started and installed its shutdown signal handlers
      When it is closed
      Then those handlers are removed from the host it installed them on
      # The host is injected rather than reached for, so a process embedding
      # this executable is not left with handlers pointing at a closed graph.
