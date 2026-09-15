# See ../adrs/001-package-boundary.md and dev/docs/adr/133-composition-spec.md
Feature: Agent coordinates linked workflows and history through their owners
  Agent owns agent definitions; Workflow, Project, User and AuditLog own their data.

  @unit @agents
  Scenario: Workflow fields describe the current graph
    Given a workflow agent points to a graph in its project
    When AgentApp reads the agent
    Then WorkflowApi supplies the graph's input and output fields
    And an archived or missing graph yields no fields and fieldsResolved false
    And a graph belonging to another project is not returned

  @unit @agents
  Scenario: Cascade archive uses the workflow owner
    Given a workflow agent points to a live graph
    When AgentApp cascade-archives the agent
    Then WorkflowApi archives the graph in the same project
    And the agent is archived and the affected workflow is reported

  @unit @agents
  Scenario: A workflow copy owns its copied graph
    Given a workflow agent is copied into another project
    When AgentApp handles the copy
    Then WorkflowApi copies the graph using the target project and author
    And the new agent points at that copied graph
    And the source graph is unchanged

  @unit @agents
  Scenario: Failed persistence compensates the graph copy
    Given WorkflowApi copied a graph into the target project
    When writing the new agent fails
    Then WorkflowApi is asked to delete the uncommitted graph
    And the original persistence failure reaches the caller
    And a failed compensation is logged without replacing the original failure

  @unit @authorization
  Scenario: Copy operations check both project boundaries
    Given an actor may manage the target project but not the source project
    When the actor copies or synchronizes an agent from that source
    Then the operation is refused before changing data
    When an actor pushes changes to copies across projects
    Then only copies in projects they may manage are updated

  @unit @agents
  Scenario: History is scoped and enriched by its owners
    Given multiple agents and projects have audit entries
    When AgentApp reads one agent's history
    Then AuditLogApi returns the newest matching entries in that project
    And subject, source and newly copied agent argument forms are matched
    And UserApi supplies each available author's id, name and email
    And an entry without an available author contains no user

  @architecture @agents
  Scenario: Workflow mapping updates cannot bypass Agent ownership
    Given Workflow recomputes a linked agent's field mappings
    When it persists the configuration
    Then it calls AgentApi with the agent, project and workflow identifiers
    And the Agent repository refuses a mismatched association
    And Workflow imports no Agent repository or generated Agent delegate

  @architecture @composition
  Scenario: Missing peer implementations fail boot
    Given Agent declares WorkflowApi and AuditLogApi as dependencies
    When a process boots without either implementation
    Then boot names the missing provider before readiness
    And it does not substitute a partial service or an always-refusing capability
