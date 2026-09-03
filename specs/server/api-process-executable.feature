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
    Scenario: A host's product services override what the process would compose
      Given a host supplies the API executable with its own product services
      When the API executable starts
      Then those services are the ones the process serves
      And the process composes none of its own in their place

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

    @integration
    Scenario: A collaborator the process goes on to compose itself is not announced as absent
      Given a deployment that supplies no Better Auth browser-session transport
      When the API executable starts
      Then it announces no adapter as one no package implements
      And it serves its lifecycle surface rather than refusing to start

    @integration
    Scenario: Each absent collaborator is named on its own line
      Given a deployment that configured neither Postgres nor Redis
      When the API executable starts
      Then the absent database, the absent queue and the absent dispatch are each named
      # One line per fact. A reader of the boot log should not have to derive
      # "no AuthZ" from "no Redis".

  Rule: Traffic is accepted only after the readiness gate passes

    @integration
    Scenario: The listener stays closed until readiness has passed
      Given a process whose readiness gate has not yet answered
      When a caller connects to the port it was configured with
      Then the connection is refused
      And it is accepted once the gate has passed

    @integration
    Scenario: A failed readiness gate is a boot failure rather than a serving process
      Given a process whose readiness gate rejects
      When it starts
      Then the boot fails with the dependency's own failure
      And nothing is listening on the port it was configured with

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
