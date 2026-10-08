Feature: Trace keeps its own copy of topic names
  Topic owns the topic model and records each change as a `topics_recorded` fact. Trace folds
  that fact into its own trace_topic_names, mirroring topic's own fold, so the trace list labels
  topic facets with no topic peer. Existing models arrive by a projection replay step.

  @unit
  Scenario: Trace folds the topics topic records and labels facets with their names
    Given topic records a model with a topic and a subtopic
    When trace's topic name fold applies the fact
    Then trace names both topics by id for that project only

  @unit
  Scenario: A replace drops the topics it no longer carries
    Given trace holds two topics for a project
    When topic records a replacing model that carries only one of them
    Then trace no longer names the removed topic
    And trace still names the topic that stayed

  @unit
  Scenario: A merge renames a topic and keeps the others
    Given trace holds two topics for a project
    When topic records a merging model that renames one of them
    Then trace names the renamed topic by its new name
    And trace still names the other topic

  @unit
  Scenario: A seed after topics exist changes nothing
    Given trace holds a topic for a project
    When topic records a seed that carries a different topic
    Then trace names only the topic it already held

  @unit
  Scenario: An unknown topic id has no label
    Given trace holds no topic for a project
    When the trace list asks for the names of topic ids
    Then no id is named and the facet keeps the id as its label

  @unit
  Scenario: Trace's topic name fold is replayed over every topic model at deploy
    Given topic models recorded before trace's topic name fold was installed on this deployment
    When the deploy's background steps run once no old worker remains
    Then trace's topic name fold is replayed from the start of topic's log
