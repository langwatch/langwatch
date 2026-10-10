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

  @unit
  Scenario: name the trace counts for the topic filter
    Given trace counts the filtered traces per topic and per subtopic id
    When a member asks for the project's topic counts
    Then each bucket carries its topic's name and its count
    And each subtopic bucket carries its parent topic id

  @unit
  Scenario: a counted topic the project no longer has is left out
    Given trace counts traces under a topic id the project no longer has
    When a member asks for the project's topic counts
    Then that bucket is absent and the others are named

  @unit
  Scenario: a malformed count answer fails the read
    Given trace's count read answers something other than topic and subtopic buckets
    When a member asks for the project's topic counts
    Then the read fails rather than answering empty counts
