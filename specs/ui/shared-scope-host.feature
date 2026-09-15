Feature: One shared scope host on every route
  Session, active scope and permission hooks read one application-owned snapshot.
  The legacy organization/team/project hook remains available during migration.
  Features never resolve a second session or navigation scope.

  Background:
    Given the browser application mounts the feature shell around every routed page

  @unit
  Scenario: The application session publishes the scope every feature reads
    Given the session has resolved a project, an organization and the caller's grants
    When a screen from any feature reads the shared organization, team and project hook
    Then it sees that project and organization
    And a permission the session granted reads as held

  @unit
  Scenario: A session with no resolved scope leaves the shared hook unresolved rather than throwing
    Given the composition installed a session that publishes no scope
    When a screen reads the shared organization, team and project hook
    Then the reading is unresolved with no project
    And every permission reads as not held

  @integration
  Scenario: Authentication resolves independently of project grants
    Given the authentication query has identified the signed-in user
    And the selected project's permissions have not answered
    When a feature reads the shared session and permissions
    Then the session is authenticated with that user
    And permissions are loading with no affirmative grants

  @integration
  Scenario: Switching users does not reuse the previous user's graph or grants
    Given the first user has resolved an organization and project grants
    When the session switches to a different user
    And the new user's organization query has not answered
    Then the previous user's organization and project are not published
    And the previous user's grants do not enable any action

  @integration
  Scenario: Switching projects discards the previous target's grants
    Given the caller can update annotations in the first project
    When navigation selects a second project
    And the second project's grant query has not answered
    Then annotation update is unavailable while its permissions load
    And a late response for the first project does not enable it

  @integration
  Scenario: A refused grant refresh clears cached affirmative permissions
    Given the current project grant query previously allowed annotation updates
    When refreshing those grants returns a forbidden error
    Then annotation update is not permitted by the shared permission reader
    And the legacy permission reader also returns false

  @integration
  Scenario: Organization permissions are independent of project permissions
    Given the caller can manage a project but cannot manage its organization
    When the shared permission reader checks organization management
    Then the project grant does not satisfy that check

  @integration
  Scenario Outline: A share route never falls back to the viewer's active project
    Given the viewer has an active project unrelated to the shared trace
    When the shared trace query is <state>
    Then the active scope does not publish the viewer's unrelated project
    And the scope reports <status>

    Examples:
      | state   | status      |
      | pending | loading     |
      | failed  | unavailable |

  @integration
  Scenario: Session connectivity failures are not anonymous sessions
    Given the session query cannot reach the authentication service
    When a feature reads the shared session
    Then the session reports offline rather than anonymous
    And the shell does not redirect to sign-in because of that failure

  @integration
  Scenario Outline: Annotation queue completion requires a successful read
    Given the annotation queue page is open
    When <condition>
    Then the page does not claim all tasks are complete
    And it displays the relevant <state> state

    Examples:
      | condition                         | state       |
      | active scope is still resolving   | loading     |
      | the queue query fails             | error       |
      | the active scope is unavailable   | unavailable |
