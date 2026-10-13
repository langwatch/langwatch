Feature: Annotation records its facts
  Annotation records every annotation write and every score definition's name as its own facts on
  the annotation_lifecycle pipeline, with the content a reader needs, so trace can fold them into
  its own read model instead of calling AnnotationApi (round 24 EF-1, ARCHITECTURE.md section 9).
  A background data step records the rows that existed before annotation recorded facts.

  @unit
  Scenario: A new annotation is recorded as annotation's created fact
    Given a project's trace
    When somebody annotates the trace with a comment, a thumb, scores and an expected output
    Then annotation records "lw.annotation.created" on the annotation's own aggregate
    And the fact carries the trace, the comment, the thumb, the scores, the expected output and the anchor
    And the fact carries neither the author nor an email

  @unit
  Scenario: An updated annotation is recorded with its new content, once per write
    Given an annotation on a trace
    When somebody changes its comment twice
    Then annotation records "lw.annotation.updated" for each write, carrying the content after it
    And a resent record of the same write records nothing new

  @unit
  Scenario: A deleted annotation is recorded as annotation's deleted fact
    Given an annotation on a trace
    When somebody deletes it
    Then annotation records "lw.annotation.deleted" naming the annotation and its trace

  @unit
  Scenario: A refused annotation write records no fact
    Given an annotation write the contract refuses, or one naming an annotation that does not exist
    When the write is attempted
    Then the write fails with its own error
    And annotation records no fact

  @unit
  Scenario: An annotation write in a process without annotation's pipeline fails loudly
    Given a process where annotation_lifecycle is not registered
    When somebody annotates a trace
    Then the write fails naming annotation_lifecycle, rather than leaving trace without the fact

  @unit
  Scenario: A new score definition is recorded as defined
    Given a project without a score definition named "Helpfulness"
    When somebody saves the score definition
    Then annotation records "lw.annotation.score_defined" carrying its id and name

  @unit
  Scenario: A renamed score definition is recorded with its previous name
    Given a score definition named "Helpfulness", soft-deleted or not
    When somebody saves it as "Usefulness"
    Then annotation records "lw.annotation.score_renamed" carrying the new and the previous name

  @unit
  Scenario: Saving a score definition without changing its name records nothing
    Given a score definition named "Helpfulness"
    When somebody saves it with a new description and the same name
    Then annotation records no score fact

  @unit
  Scenario: The annotation module declares its pipeline and no migration step
    Given the annotation process module
    When a process collects its eventing and its migration steps
    Then it registers annotation_lifecycle
    And it declares no migration step
