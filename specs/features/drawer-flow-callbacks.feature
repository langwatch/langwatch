Feature: Drawer flow callbacks
  A flow that walks through several drawers registers its callbacks by drawer
  type, so the drawer it opens later can call back into the flow that started
  it. The registry is one map for the whole application.

  Closing a drawer ends the flows that ran through it, so their callbacks go.
  A callback a mounted component registered for its own drawer is not one of
  them: the component is still there, it takes its registration back itself on
  unmount, and nothing tells it that a drawer somewhere else was closed.

  @unit
  Scenario: Closing a drawer clears the callbacks of the flows
    Given two drawers with flow callbacks registered for them
    When the drawer is closed
    Then neither registration is left

  @unit
  Scenario: A registration a mounted component holds survives a close
    Given a callback registered for a drawer with keepOnClose
    And a callback registered for another drawer without it
    When the drawer is closed
    Then only the registration with keepOnClose is left

  @unit
  Scenario: A component takes its own registration back
    Given a callback registered for a drawer with keepOnClose
    When the component registers an empty set for that drawer
    And the drawer is closed
    Then nothing is left for that drawer
