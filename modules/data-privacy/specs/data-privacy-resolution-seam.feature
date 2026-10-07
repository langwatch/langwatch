Feature: A project's privacy policy resolves without the write graph
  Every span LangWatch folds asks which content categories the customer wanted
  dropped and which redacted, and the answer is inherited down organization,
  team, department and project. Data privacy keeps its own fold of where each
  project sits, from project's facts (created, moved, department assigned,
  archived), so resolving a policy asks no other module anything (record §5).

  Rule: The resolution composes from a database and data privacy's own project-scope fold

    @unit
    Scenario: The policy resolution composes from a database and its own project-scope fold
      Given a policy store and a folded scope for a project
      When a project's policy is resolved
      Then the inheritance chain is read inside that project's own organization

    @unit
    Scenario: A stored drop rule reaches the resolved policy
      Given a project-scoped rule that drops the input category
      When the project's policy is resolved
      Then the resolved policy drops the input category

    @unit
    Scenario: A second resolution inside the window reuses the first
      Given a project whose policy has just been resolved
      When it is resolved again inside the cache window
      Then the policy rows are read once

  Rule: Data privacy folds where each project sits from project's facts

    @unit
    Scenario: A new project's scope folds from project's created fact
      Given project records a created fact naming the project's organization, team and that it is not personal
      When data privacy folds it
      Then the project's policy resolves through that organization and team, with no department

    @unit
    Scenario: A moved project resolves through its new team
      Given a folded project in team "alpha"
      When project records that it moved to team "beta"
      Then the project's policy resolves through team "beta"

    @unit
    Scenario: A department assigned to a project reaches its resolved policy
      Given a folded project with no department
      When project records a department-assigned fact naming department "risk"
      Then the project's policy resolves through department "risk"

    @unit
    Scenario: A late or repeated project fact does not overwrite a newer one
      Given a project folded from a move recorded after its department-assigned fact
      When the older department-assigned fact is delivered again
      Then the project still resolves through the team the move named
      And its department is the one the department-assigned fact named

    @unit
    Scenario: A project whose scope has not folded yet is refused as not found
      Given a project data privacy has no folded scope for, or only a created fact recorded before created facts named a team
      When its policy is resolved
      Then the resolution is refused with project_not_found, so a trace job retries until the fact folds

    @unit
    Scenario: An archived project no longer resolves
      Given a folded project
      When project records that it was archived
      Then its policy resolution is refused with project_not_found

    @unit
    Scenario: Data privacy keeps no project peer
      Given a process that installs data privacy in the worker role beside project's facts
      When it boots and project records a project's department assignment
      Then data privacy names no project dependency and resolves that project from its own fold
