Feature: Departments - org-chart spend attribution across people, teams, and projects
  The bird's-eye dashboard answered "spend by team" and "spend by user"
  but could not answer "are marketing people spending more than
  engineering people, including their personal AI use?". Teams are a
  many-to-many access construct (a person can be in several), so they are
  a poor single attribution key, and RBAC roles answer authorization, not
  accounting.

  A department is a single-valued accounting dimension, separate from
  RBAC. An org admin names departments (Engineering, Marketing, ...) on a
  dedicated departments page, but assigns them where the org chart already
  lives: per row on the members and teams pages, and on project settings.
  The departments page itself only creates and manages the departments and
  links out to those surfaces, so it never becomes an unscrollable list of
  every person in a large org. Spend rolls up by the department resolved
  from each trace, so personal usage and the autonomous agents a team
  builds can land in the same department.

  For organizations that provision identities through SCIM, assignment is
  automatic: the SCIM 2.0 Enterprise User extension carries a standard
  "costCenter" attribute, so an IdP (Okta, Entra ID, ...) can drive
  department membership the same way it drives department or division.
  Manual per-row assignment is the fallback for orgs without SCIM.

  Departments are pure accounting. They never grant or restrict access.

  Pairs with:
    - specs/ai-gateway/governance/birds-eye-dashboard-v2.feature (dashboard)
    - specs/ai-gateway/governance/activity-monitor.feature (data path)
    - specs/ai-gateway/governance/ingestion-attribution.feature (principal attribution)

  Implementation lives under:
    - langwatch/ee/governance/services/department/                  (attribution + service)
    - langwatch/ee/governance/routers/departments.ts                (tRPC)
    - langwatch/ee/governance/services/activity-monitor/            (bird-eye rollup)
    - langwatch/src/server/scim/scim.service.ts                     (SCIM auto-assignment)

  Background:
    Given the user is signed in as an org admin of "acme-corp"
    And the governance preview flag is enabled for acme-corp

  # ---------------------------------------------------------------------------
  # Attribution precedence (pure resolver - unit)
  # ---------------------------------------------------------------------------

  @bdd @departments @attribution @unit
  Scenario: A trace with a principal user attributes to the user's department
    Given a trace whose principal user is in department "Marketing"
    When the trace is attributed to a department
    Then it resolves to "Marketing" via the principal user

  @bdd @departments @attribution @unit
  Scenario: An agent trace with no principal user attributes to its project's department
    Given a trace with no principal user from a project in department "Engineering"
    When the trace is attributed to a department
    Then it resolves to "Engineering" via the project

  @bdd @departments @attribution @unit
  Scenario: Principal user department wins over the project's department
    Given a trace whose principal user is in department "Marketing"
    And the project the trace ran in is in department "Engineering"
    When the trace is attributed to a department
    Then it resolves to "Marketing", not "Engineering", counted once

  @bdd @departments @attribution @unit
  Scenario: A member with no own department inherits their team's department
    Given a trace whose principal user has no own department
    And the user's team is in department "Engineering"
    When the trace is attributed to a department
    Then it resolves to "Engineering" via the inherited team department

  @bdd @departments @attribution @unit
  Scenario: A trace with no resolvable department falls back to Unassigned
    Given a trace whose principal user, team, and project all have no department
    When the trace is attributed to a department
    Then it resolves to "Unassigned"

  # ---------------------------------------------------------------------------
  # Department entity + assignment (service + DB)
  # ---------------------------------------------------------------------------

  @bdd @departments @integration
  Scenario: Admin creates and names a department
    When the admin creates a department named "Engineering"
    Then the department belongs to acme-corp
    And it appears in the department list for the org
    And a member of another org never sees it

  @bdd @departments @integration
  Scenario: A person is assigned to a single department per org
    Given a department "Marketing" exists in acme-corp
    When the admin assigns the member "robin" to "Marketing"
    Then robin's membership in acme-corp carries department "Marketing"
    And assigning robin to a different department replaces the prior one
      rather than adding a second

  @bdd @departments @integration
  Scenario: Teams and projects are assignable to a department
    Given a department "Engineering" exists in acme-corp
    When the admin assigns the team "platform" to "Engineering"
    And the admin assigns the project "internal-agent" to "Engineering"
    Then the team and the project both carry department "Engineering"
    And a person, a team, and a project can all share one department

  @bdd @departments @integration
  Scenario: Archiving a department leaves assignments resolvable as Unassigned
    Given a department "Legacy" with assigned members and projects
    When the admin archives "Legacy"
    Then it no longer appears in the assignment picker
    And spend previously attributed to it rolls up under "Unassigned"
      rather than disappearing

  # ---------------------------------------------------------------------------
  # Where assignment happens (UI surface - the redesign)
  # An org can have tens of thousands of members, so assignment lives on the
  # pages that already paginate the org chart, not as one flat list.
  # ---------------------------------------------------------------------------

  @bdd @departments @ui
  Scenario: The departments page manages departments and links out to assign them
    Given the admin opens the departments page
    Then the page lets the admin create, rename, and archive departments
    And it does not render a per-person assignment list
    And it links to the members and teams pages where people and teams are
      assigned

  @bdd @departments @ui
  Scenario: A member is assigned to a department from the members page
    Given a department "Marketing" exists in acme-corp
    When the admin sets "robin" to "Marketing" from the members page row
    Then robin's membership carries department "Marketing"
    And the change is visible without leaving the members page

  @bdd @departments @ui
  Scenario: A team is assigned to a department from the teams page
    Given a department "Engineering" exists in acme-corp
    When the admin sets the team "platform" to "Engineering" from the teams
      page row
    Then the team carries department "Engineering"

  @bdd @departments @ui
  Scenario: The department control appears only once departments are configured
    Given no departments exist yet in acme-corp
    Then the members and teams pages show no department column
    When the admin creates the first department
    Then the department column appears on the members and teams pages

  # ---------------------------------------------------------------------------
  # SCIM auto-assignment (enterprise standard)
  # ---------------------------------------------------------------------------

  @bdd @departments @scim @integration
  Scenario: A SCIM-provisioned user is assigned from the enterprise costCenter attribute
    Given acme-corp provisions users through SCIM
    And a department "Engineering" exists in acme-corp
    When the IdP provisions a user whose enterprise costCenter is "Engineering"
    Then that user's membership carries department "Engineering"

  @bdd @departments @scim @integration
  Scenario: An unrecognized SCIM costCenter creates the department on first use
    Given acme-corp provisions users through SCIM
    And no department named "Research" exists yet
    When the IdP provisions a user whose enterprise costCenter is "Research"
    Then a department "Research" is created in acme-corp
    And that user is assigned to it

  @bdd @departments @scim @integration
  Scenario: Updating the SCIM costCenter reassigns the user
    Given a SCIM-provisioned user currently assigned to "Engineering"
    When the IdP updates that user's enterprise costCenter to "Marketing"
    Then the user's membership carries department "Marketing", replacing the
      prior assignment

  @bdd @departments @scim @integration
  Scenario: Clearing the SCIM costCenter unassigns the user
    Given a SCIM-provisioned user currently assigned to "Engineering"
    When the IdP removes that user's enterprise costCenter attribute
    Then the user's membership carries no department
    And their spend rolls up under "Unassigned"

  # ---------------------------------------------------------------------------
  # Bird's-eye spend by department (the #5 fix: aggregate across all org projects)
  # ---------------------------------------------------------------------------

  @bdd @departments @birds-eye @integration
  Scenario: Spend by department aggregates across every project in the org
    Given members generate spend in their personal projects
    And teams generate spend in their team projects
    And none of that traffic flows through a governance ingestion source
    When the dashboard renders the "Spend by department" card
    Then each department's total includes spend from personal projects,
      team projects, and agent projects attributed to it
    And the card is not limited to the governance ingestion project
      (regression: the prior dashboard read only the single governance
      project, so a fully-active org with no ingestion source showed
      empty graphs)

  @bdd @departments @birds-eye @ch @integration
  Scenario: Spend-by-department query stays tenant-isolated
    Given two orgs each with spend under like-named departments
    When acme-corp's admin loads the dashboard
    Then the department rollup contains zero spend from the other org
    And every underlying ClickHouse query filters by TenantId first

  @bdd @departments @birds-eye @integration
  Scenario: Marketing-versus-engineering comparison reads from departments
    Given members in "Marketing" and members in "Engineering" both have
      personal AI spend in the window
    When the dashboard renders the "Spend by department" card
    Then "Marketing" and "Engineering" each show their members' combined
      personal and project spend
    And the comparison does not depend on RBAC roles or team membership
      counts
