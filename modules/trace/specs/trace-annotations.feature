Feature: Trace reads annotations and score names from annotation's shared tables
  Annotation owns annotations and score definitions and declares its Annotation and
  AnnotationScore tables shared for reading by trace, so trace keeps no copy of them. Trace's
  legacy read attaches a page's annotations and names their scores from annotation's rows.

  @unit
  Scenario: Trace reads every annotation on a page's traces, oldest first, whatever its anchor
    Given annotation holds annotations on a project's traces, one anchored to a span
    When trace reads the annotations of those traces
    Then trace asks only that project's rows on those traces, oldest first, with no anchor filter
    And each annotation carries its content and its scores keyed by score definition id

  @unit
  Scenario: A soft-deleted score definition still names its old results
    Given annotation holds a score definition it has soft-deleted
    When trace reads the project's score names
    Then trace asks every definition of that project, deleted ones included

  @integration
  Scenario: Trace's legacy read attaches annotations from annotation's tables
    Given annotation's tables hold an annotation scoring a named score
    When the legacy read projects the trace's annotations
    Then the annotation carries its scores under the score's name
