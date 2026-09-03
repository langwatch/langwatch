Feature: Topic read surface

  The Topic service is the single read capability for the projected topic
  model and its clustering status, exposed through the process-owned
  application's `app.topics`. The Topic server owns clustering commands,
  process logic, projections, and private persistence; the application only
  composes its technical ports and transports.

  @unit
  Scenario: list topics for a project
    When a caller asks the Topic service for a project's topics
    Then it receives the projected topic ids, names, parent ids, and origin

  @unit
  Scenario: resolve names for trace facets
    When a caller asks for names of topic ids in a project
    Then known ids are returned with their names
    And unknown ids are absent

  @unit
  Scenario: read clustering status and history
    When a caller asks for a project's clustering status
    Then it receives the projected outcome and the next durable wake
    And run history contains no raw provider error text

  @unit
  Scenario: tolerate an unavailable history projection
    Given the history JSON is missing or malformed
    When a caller asks for the project's clustering history
    Then it receives an empty history that can be rebuilt from events
