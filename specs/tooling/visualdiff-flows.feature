Feature: visualdiff flow vocabulary
  The flows file and the step vocabulary both sides of a run share.

  @unit
  Scenario: A flow id defined in two files is refused
    When two flow files define the same flow id
    Then loading the config is refused

  @unit
  Scenario: An expect with an unknown key is refused
    When an expect uses a key outside the runner's vocabulary
    Then it is refused

  @unit
  Scenario: The shipped flows all validate
    When the shipped config loads
    Then it validates and holds its core flows

  @unit
  Scenario: Every flow suffixes what it creates with its own token
    When a flow's step text holds {uid}, a captured value or a fixture
    Then each is filled and other braces are left alone
    And each flow has a token of its own that both sides agree on

  @unit
  Scenario: A flow that changes project settings works in a project of its own
    When a flow that changes project settings runs
    Then it works in the isolated project when the seed made one
    And says so instead of editing the main project when there is none
    And every other flow stays in the main project

  @unit
  Scenario: Steps target elements by test id, prefix or label
    When a step names a test id, prefix or label
    Then it targets the visible element it names, and plain text does not name an element

  @unit
  Scenario: An expect on an element counts what is on screen
    When an element or status expect is described
    Then both sides describe it the same way

  @unit
  Scenario: A mail step reads the newest matching message
    When several messages match a mail step
    Then the latest received is read and one that cannot be placed in time is ignored

  @unit
  Scenario: An upload step attaches a file from the fixtures directory
    When an upload step names a fixture
    Then a bare name resolves inside the fixtures directory and one that climbs out is refused
