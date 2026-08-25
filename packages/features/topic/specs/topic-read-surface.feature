Feature: Topic read surface

  The Topic service is the single read capability for the projected topic
  model and its clustering status.

  Scenario: list topics for a project
    When a caller asks the Topic service for a project's topics
    Then it receives the projected topic ids, names, parent ids, and origin

  Scenario: resolve names for trace facets
    When a caller asks for names of topic ids in a project
    Then known ids are returned with their names
    And unknown ids are absent

  Scenario: read clustering status and history
    When a caller asks for a project's clustering status
    Then it receives the projected outcome and the next durable wake
    And run history contains no raw provider error text
