Feature: Trace keeps its own copy of annotations and their score names
  Annotation owns annotations and records created, updated and deleted facts with their
  content, and score-definition facts with their names. Trace folds them into its own
  trace_annotations and trace_annotation_scores, so its legacy read attaches annotations and
  names their scores with no annotation peer. Existing rows arrive by projection replay steps.

  @unit
  Scenario: Trace folds an annotation and names its scores
    Given annotation records a score definition and an annotation on a trace scoring it
    When trace's annotation folds apply the facts
    Then trace lists the annotation on that trace with its content
    And trace names the score by its definition id

  @unit
  Scenario: The newest content wins whatever order the facts arrive in
    Given annotation records an update of an annotation
    When an older backfilled copy of the annotation arrives after the update
    Then trace keeps the updated content

  @unit
  Scenario: A deleted annotation is not listed
    Given trace holds an annotation on a trace
    When annotation records that the annotation was deleted
    Then trace lists no annotation on that trace

  @unit
  Scenario: A backfill racing a delete does not bring the annotation back
    Given annotation records that an annotation was deleted
    When a backfilled created fact for the same annotation arrives after the delete
    Then trace lists no annotation on that trace

  @unit
  Scenario: A redelivered annotation fact leaves one annotation
    Given annotation's created fact is delivered to trace twice
    When trace's annotation fold applies both deliveries
    Then trace lists the annotation once

  @unit
  Scenario: A renamed score names its old results
    Given annotation records a score definition and then renames it
    When trace's score fold applies both facts
    Then trace names the score by its new name

  @integration
  Scenario: Trace's legacy read attaches annotations from its own fold
    Given trace's annotation fold holds an annotation scoring a named score
    When the legacy read projects the trace's annotations
    Then the annotation carries its scores under the score's name, without asking annotation

  @unit
  Scenario: Trace's annotation folds are replayed over every annotation fact at deploy
    Given annotation facts recorded before trace's annotation folds were installed on this deployment
    When the deploy's background steps run once no old worker remains
    Then trace's annotation and score folds are replayed from the start of annotation's log
