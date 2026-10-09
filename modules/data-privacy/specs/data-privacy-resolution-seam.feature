Feature: A project's privacy policy resolves without the write graph
  Every span LangWatch folds asks which content categories the customer wanted
  dropped and which redacted, and the answer is inherited down organization,
  team, department and project. Data privacy reads where each project sits from
  project's `Project` table, organization's `Team` and `OrganizationUser` tables through the shares
  their owners declare (R40, round 46 E1), so resolving a policy asks no other
  module anything (record §5) and keeps no copy to fill at deploy (plan R01).

  Rule: The resolution composes from a database and data privacy's placement reader

    @unit
    Scenario: The policy resolution composes from a database and its placement reader
      Given a policy store and a project placed by project's and organization's rows
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
      Then the policy rows and the project's placement are each read once

  Rule: Data privacy reads where each project sits from its owners' rows

    @unit
    Scenario: An existing project resolves its privacy policy on the first request after deploy
      Given project's table places a project in a team of an organisation, and project recorded no fact for it
      When its policy is resolved
      Then it resolves through that organization and team, with no department

    @unit
    Scenario: A moved project resolves through its new team
      Given a project whose row names team "beta"
      When its policy is resolved
      Then the project's policy resolves through team "beta"

    @unit
    Scenario: A department assigned to a project reaches its resolved policy
      Given a project whose row names department "risk"
      When its policy is resolved
      Then the project's policy resolves through department "risk"

    @unit
    Scenario: A project with no row is refused as not found
      Given a project project's table holds no row for
      When its policy is resolved
      Then the resolution is refused with project_not_found

    @unit
    Scenario: An archived project resolves its privacy policy as on main
      Given a project whose row is archived
      When its policy is resolved
      Then it resolves through its organization, team and department, as a live project does

    @unit
    Scenario: A personal project takes its department from its owner's membership
      Given a personal project whose owner's membership in the organisation names department "risk"
      When its policy is resolved
      Then the project's policy resolves through department "risk"
      And the project's own department column is ignored

    @unit
    Scenario: A personal project whose owner has no department resolves with none
      Given a personal project whose owner has no membership department, or has no owner
      When its policy is resolved
      Then the project's policy resolves with no department

    @unit
    Scenario: Data privacy keeps no project peer and no project-scope fold
      Given a process that installs data privacy in the worker role beside project
      When it boots
      Then data privacy names no project dependency and runs no project-scope pipeline

    @unit
    Scenario: The memory and Postgres placement readers answer alike
      Given an organisation with a team holding a live project in a department, an archived one and a personal one
      When each placement reader is asked for those projects
      Then both answer the same team, organisation and department, the personal project's from its owner's membership
      And neither knows a project that has no row
