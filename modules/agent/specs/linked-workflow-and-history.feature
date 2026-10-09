# See ../adrs/001-package-boundary.md and dev/docs/adr/133-composition-spec.md
Feature: Agent coordinates linked workflows and history through their owners
  Agent owns agent definitions; Workflow, Project, User and AuditLog own their data.

  @unit @agents
  Scenario: Workflow fields describe the current graph
    Given a workflow agent points to a graph in its project
    And workflow records the graph's current version with its input and output fields
    When Agent's peer subscriber handles the fact and AgentModule reads the agent
    Then the agent reports the fields stored in its own config, with no call to workflow
    And an archived graph, or one no fact has named, yields no fields and fieldsResolved false
    And a fact for a graph in another project changes no agent

  @unit @agents
  Scenario: A redelivered workflow version fact writes the fields once
    Given Agent already stored the fields of a workflow version fact
    When the same fact is delivered again
    Then both deliveries share one deduplication id and the agent's config is written once

  @unit @agents
  Scenario: A workflow fact older than the stored fields changes nothing
    Given an agent whose stored fields came from a newer workflow fact
    When an older version_saved or archived fact arrives
    Then the stored fields are left as they are

  @unit @agents
  Scenario: Editing a workflow agent keeps the fields workflow recorded
    Given a workflow agent with fields workflow recorded
    When the agent is edited and still points at the same graph
    Then the recorded fields are kept, whatever the edit sent for them
    And pointing the agent at another graph drops them until workflow records that graph

  @unit @agents
  Scenario: The archive dialog names the linked workflow through Workflow
    Given a workflow agent points to a graph in its project
    When the Agents screen asks what archiving the agent will also archive
    Then the browser reads the graph's name from Workflow's own list for that project
    And an agent without a graph, or whose graph is archived or missing, names no workflow
    And Agent's server reads no workflow name for it

  @unit @agents
  Scenario: Cascade archive uses the workflow owner
    Given a workflow agent points to a live graph
    When AgentModule cascade-archives the agent
    Then the agent is archived and the linked workflow is reported
    And Agent records the agent archived, naming the graph for Workflow to archive from its own side
    And Agent calls no Workflow operation to archive it

  @unit @agents
  Scenario: A plain archive records the agent archived with no graph to cascade
    Given a workflow agent points to a live graph
    When AgentModule archives the agent alone
    Then Agent records the agent archived naming no graph

  @unit @agents
  Scenario: A copy's row points at the graph workflow copied
    Given Workflow copied a workflow agent's graph into the target project
    When Workflow asks AgentModule to create the agent's copy naming that graph
    Then the new agent points at that copied graph and names its source agent
    And the source agent is unchanged
    And AgentModule calls no Workflow operation for the copy

  @unit @authorization
  Scenario: Copy operations check both project boundaries
    Given an actor may manage the target project but not the source project
    When the actor synchronizes an agent copy from that source
    Then the operation is refused before changing data
    When an actor pushes changes to copies across projects
    Then only copies in projects they may manage are updated

  @unit @agents
  Scenario: History is scoped and enriched by its owners
    Given multiple agents and projects have audit entries
    When AgentModule reads one agent's history
    Then AuditLogApi returns the newest matching entries in that project
    And subject, source and newly copied agent argument forms are matched
    And copies audited at Workflow's copy door are listed beside the agent's own entries, newest first
    And UserApi supplies each available author's id, name and email
    And an entry without an available author contains no user

  @unit @architecture @agents
  Scenario: Workflow mapping updates cannot bypass Agent ownership
    Given Workflow recomputes a linked agent's field mappings
    When it persists the configuration
    Then it calls AgentApi with the agent, project and workflow identifiers
    And the Agent repository refuses a mismatched association
    And Workflow imports no Agent repository or generated Agent delegate

  @unit @architecture @composition
  Scenario: Missing peer implementations fail boot
    Given Agent declares WorkflowApi and AuditLogApi as dependencies
    When a process boots without either implementation
    Then boot names the missing provider before readiness
    And it does not substitute a partial service or an always-refusing capability
