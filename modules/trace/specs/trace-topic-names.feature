Feature: Trace reads topic names from topic's shared table
  Topic owns the topic model and declares its Topic table shared for reading by trace, so trace
  keeps no copy of topic names. The trace list labels topic facets with the names topic holds.

  @unit
  Scenario: Trace names topic facets from the topics topic holds
    Given topic holds a topic and a subtopic for a project
    When the trace list asks for the names of their ids
    Then trace names both topics by id, reading only that project's topics

  @unit
  Scenario: No topic id asks topic's table nothing
    Given a facet page that carries no topic id
    When the trace list asks for the names of no ids
    Then trace answers no names without reading topic's table

  @unit
  Scenario: An unknown topic id has no label
    Given topic holds no topic for a project
    When the trace list asks for the names of topic ids
    Then no id is named and the facet keeps the id as its label
