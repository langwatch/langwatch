Feature: Optimization studio execution on a per-project Lambda

  The hosted product runs every project's studio graph on that project's own
  function, so one tenant's code block cannot reach another's, and streams the
  engine's events back as they are produced. A self-hosted install runs the same
  graphs at a single engine address. Both are supported shapes; a deployment
  half-way between the two is not, and says so.

  @unit
  Scenario: A complete Lambda fleet configuration composes the Lambda path
    Given the deployment describes its per-project execution fleet
    When the studio's dispatch is composed
    Then studio graphs run on the project's own function

  @unit
  Scenario: An absent or unusable fleet configuration leaves the HTTP path
    Given the deployment names an engine address and no execution fleet
    When the studio's dispatch is composed
    Then studio graphs run at that address

  @unit
  Scenario: A deployment with no engine at all refuses by name
    Given the deployment names neither an engine address nor an execution fleet
    When a studio run is dispatched
    Then it is refused by name rather than sent nowhere

  @unit
  Scenario: A named but unusable fleet refuses instead of falling back
    Given the deployment names an execution fleet it does not describe
    When a studio run is dispatched
    Then it is refused by name
    And it is not quietly served from the shared engine address

  @unit
  Scenario: The studio run is invoked on the project's own function
    Given a project whose studio runs on its own function
    When a studio event is dispatched
    Then the run is sent to the engine's streaming studio route
    And it carries the origin the run was started from

  @unit
  Scenario: Studio events arrive in order with the Lambda prelude stripped
    Given a project whose studio runs on its own function
    When the engine streams its events back
    Then the caller receives each event in the order it was produced
    And the caller never receives the transport's own framing

  @unit
  Scenario: A failed invocation reaches the caller as a named workflow failure
    Given a studio run whose invocation fails part way through
    When the caller reads the stream
    Then the run fails as a workflow execution failure
    And the failure carries a stable code the product has copy for

  @unit
  Scenario: A non-success status reaches the caller as a named workflow failure
    Given a studio run the engine answers with an error status
    When the caller reads the stream
    Then the run fails as a workflow execution failure
    And the engine's own explanation is carried with it

  @unit
  Scenario: Cancelling the stream aborts the invocation
    Given a studio run in progress
    When the viewer stops watching it
    Then the invocation is aborted rather than left running

  @unit
  Scenario: An oversized studio payload is parked in object storage
    Given a studio graph larger than one invocation may carry
    When the run is dispatched
    Then the graph is parked in object storage and its location sent instead
    And the parked graph is dropped once the run ends

  @unit
  Scenario: An oversized studio payload with nowhere to park refuses by name
    Given a studio graph larger than one invocation may carry
    And a deployment with no object storage to park it in
    When the run is dispatched
    Then it is refused by name rather than sent over the invocation limit

  @unit
  Scenario: Every per-project function carries the same environment
    Given the deployment describes its per-project execution fleet
    When a project's function is created or brought up to date
    Then both use the same environment, so the two cannot drift apart

  @unit
  Scenario: The code-block ceiling stays under both enclosing deadlines
    Given an operator sets the engine's code-block ceiling
    When a project's function is given that ceiling
    Then the ceiling stays under the invocation and stream deadlines that enclose it
    And an unusable value falls back to the engine's own default

  @unit
  Scenario: A project without a function gets one created
    Given a project whose studio engine has no function yet
    When a studio run resolves where to execute
    Then the function is created from the deployment's image, network and environment

  @unit
  Scenario: An existing function is brought up to the deployment's configuration
    Given a project whose function was born with a different configuration
    When a studio run resolves where to execute
    Then the function's configuration is reconciled
    And anything an operator set outside this code is left alone
