Feature: The standalone API process composes its own agent service
  As an operator running a LangWatch API deployment
  I want the API process to build the agent service its RPC surface serves
  So that the agents door does not require a second process to hand it one

  # WHY THIS EXISTS
  #
  # `API_UNAVAILABLE_PRODUCT_ADAPTERS` named "AgentsWorkflowPort and
  # AgentsAuditLogPort: agent workflow copies and agent audit history" as the
  # reason the agent service had to arrive from a host. The ports were always
  # the Agents package's; what was missing was any implementation of them
  # outside the legacy application.
  #
  # `@langwatch/agent-server` has them now — `PostgresAgentAdapter` builds the
  # repository, the linked-workflow reads and the audit-history read from ONE
  # guarded Prisma client, which is the client this process already composes.
  #
  # One capability did not come with them, and it is named rather than hidden.
  # Copying a WORKFLOW agent copies the Studio graph it points at, which is the
  # Workflow application's `copy` — a dataset copier, a DSL rewriter and the
  # version rules behind them. This process composes no Workflow application,
  # so it composes no workflow-copy capability, and the agent service it builds
  # refuses that one operation by name instead of writing an agent that points
  # at another project's graph.

  Rule: A process with a database composes the agent service itself

    @unit
    Scenario: The API process composes its own agent service
      Given the deployment configured a database
      And no host supplied an agent service
      When the process composes
      Then it builds the agent service over its own guarded client
      And the agents RPC surface is served from it

    @unit
    Scenario: An injected agent service is the one the process serves
      Given a host supplies the API process with its own agent service
      When the process composes
      Then the agents surface is served by the host's service
      And the process composes none of its own
      # A second agent service in one process would read the same rows through
      # two graphs, and only one of them would be the one a host can observe.

    @unit
    Scenario: A process with no database composes no agent service
      Given the deployment configured no database
      And no host supplied an agent service
      When the process composes
      Then it composes no agent service, and names the missing half at boot
      And no agents RPC surface is mounted
      # Absent rather than mounted, for the same reason the secret door is:
      # a door that answers every call with a 500 is worse than one that is
      # not there.

  Rule: The one capability it cannot compose is announced at boot

    @unit
    Scenario: The process says it copies no workflow agents
      Given the process is composing its own agent service
      When it composes
      Then it records that it holds no workflow-copy capability
      And every other agent operation is served

    # The boot statement used to carry a standing list of adapters no package
    # implemented, and the entries that closed had to be removed from it by
    # hand. The list outlived its last true entry and was deleted; what the
    # agent service does or does not hold is stated by the service composing
    # it, in the scenario above.
