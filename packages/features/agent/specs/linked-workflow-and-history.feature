Feature: An agent's linked workflow and its audit history are the package's own
  As an Agents feature maintainer
  I want the two collaborators AgentService reads through to have packaged
  Postgres implementations
  So that any process holding a guarded Prisma client can compose the agent
  service instead of receiving one from the legacy application

  # WHY THIS EXISTS
  #
  # `AgentsWorkflowPort` and `AgentsAuditLogPort` were declared here and
  # implemented in exactly one place: the legacy application's
  # `AgentsFeature`. That is what put "AgentsWorkflowPort and
  # AgentsAuditLogPort" on `API_UNAVAILABLE_PRODUCT_ADAPTERS` — not the ports
  # themselves, which are this package's, but the absence of anything else
  # that satisfied them.
  #
  # Read one operation at a time, almost none of that implementation needed
  # the application. Four of the workflow port's five methods are plain reads
  # and writes over `Workflow` and `WorkflowVersion`, and the field derivation
  # they feed is `@langwatch/workflow-contract`'s own entry and end-node
  # walk. The audit port is one read over `AuditLog` joined to the authors of
  # the entries it returned. All of it is Postgres, and Postgres is not the
  # application's to own.
  #
  # One operation is genuinely different. Copying a WORKFLOW agent copies the
  # Studio graph it points at, and that is the Workflow lifecycle's own
  # `copy` — a dataset copier, a DSL rewriter and the version rules behind
  # them. A process that does not compose the Workflow application cannot do
  # it, and must not pretend to: an agent copied without its graph is an agent
  # pointing at another project's workflow.
  #
  # So the copy is a port of its own, and a process that holds no
  # implementation gets one that refuses by name rather than one that silently
  # produces a broken copy.

  Rule: The Postgres adapter composes the whole agent service from one client

    @unit @agents
    Scenario: A workflow agent reports the fields of the graph it points at
      Given an agent of type workflow whose linked graph has entry and end nodes
      When the composed service reads that agent
      Then its input fields are the graph's mapping surface
      And its output fields are the graph's end-node inputs
      # Derived on every read rather than copied onto the agent: editing the
      # graph must not leave the agent describing a shape it no longer has.

    @unit @agents
    Scenario: A workflow agent whose graph cannot be read reports no fields
      Given an agent of type workflow whose linked graph is archived or absent
      When the composed service reads that agent
      Then it reports no fields and says they were not resolved
      # Never one invented field named "output": a caller that cannot tell
      # "unknown" from "one output" has no way to avoid repeating that.

    @unit @agents
    Scenario: The related entity of a workflow agent is its linked workflow
      Given an agent of type workflow linked to a workflow in the same project
      When the composed service is asked what the agent is related to
      Then it answers with that workflow's id and name
      And a workflow in another project is not returned

    @unit @agents
    Scenario: Archiving a workflow agent archives the graph with it
      Given an agent of type workflow linked to a live workflow
      When the composed service cascade-archives the agent
      Then the linked workflow is archived in the same project
      And the archived workflow is reported back to the caller

    @unit @agents
    Scenario: An agent's history is the project's agent audit entries with their authors
      Given the project's audit log holds entries whose action begins with "agents."
      When the composed service reads one agent's history
      Then it returns the newest entries for that agent
      And each entry carries the user who wrote it, when the entry named one
      And an entry written by nobody carries no user rather than failing

    @unit @agents
    Scenario: History is scoped to the project and to the agent named
      Given audit entries exist for other agents and for other projects
      When the composed service reads one agent's history
      Then only that agent's entries in that project are returned
      # The entry may name the agent as its subject, its source or the copy it
      # created, so all three argument shapes count as that agent's history.

  Rule: A process with no Workflow application copies no workflow agent

    @unit @agents
    Scenario: Copying a non-workflow agent needs no Workflow application
      Given a process composed the agent service with no workflow-copy capability
      And the source agent is a signature agent
      When the caller copies it into another project
      Then the copy is written and no workflow is touched

    @unit @agents
    Scenario: Copying a workflow agent without one refuses by name
      Given a process composed the agent service with no workflow-copy capability
      And the source agent is a workflow agent
      When the caller copies it into another project
      Then the copy is refused, naming the capability the process does not hold
      And no agent row is written
      # A copy that skipped the graph would leave the new agent pointing at the
      # source project's workflow — a cross-project reference that reads as a
      # successful copy.

    @unit @agents
    Scenario: A supplied capability is what a workflow-agent copy goes through
      Given a process composed the agent service with a workflow-copy capability
      And the source agent is a workflow agent
      When the caller copies it into another project
      Then the graph is copied through that capability
      And the new agent points at the copied graph

    @unit @agents
    Scenario: A failed agent write takes the copied graph back out
      Given a workflow agent's graph has been copied into the target project
      When writing the agent row fails
      Then the copied graph is removed from the target project
      And the original failure is what the caller is told about
