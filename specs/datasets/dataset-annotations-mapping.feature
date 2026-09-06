Feature: Annotations in a dataset mapping
  As someone building an evaluation dataset out of reviewed traces
  I want each row to carry what the reviewers said about the trace
  So that a human or an LLM judge can read the review without knowing our schema

  # Context: the "Add to Dataset" drawer maps a trace onto dataset columns. The
  # annotations source used to expose one narrow field per column (the comment,
  # the thumbs, one score), which meant a row could quote a comment while losing
  # the part of the trace it was about, who wrote it, and how they scored it.
  #
  # `ai_readable` is one column that carries the whole review as a sentence:
  #
  #   <author>[ (on <part of the trace>)][: <comment>][ [thumbs up|thumbs down]]
  #   [ [<score name>: <value>[, reason: <reason>]]]... [ [suggested output: <text>]]
  #
  # Everything after the author is left out when it does not exist, so a bare
  # comment on a trace reads as "Ada: too terse" and nothing else.
  #
  # The row leaves the product, so it names things for a reader with no trace on
  # screen: a part reads "web_search span (0af31b2c)" or "Trace (95bf974e)",
  # carrying enough id to match against the waterfall when two spans share a
  # name. On screen the ids are noise and the chips stay as they are.
  #
  # Whatever the reviewer did not fill in is not in the row at all, in both the
  # readable line and the whole-annotation column: a row that says
  # "is_thumbs_up": null, "expected_output": null teaches the reader our schema
  # and nothing about the review.

  Background:
    Given my project has traces that reviewers have commented on

  # ============================================================================
  # Anchored comments reach the mapping
  # ============================================================================

  @integration
  Scenario: A comment left on a span reaches the dataset mapping
    Given a reviewer commented on one span of a trace rather than on the whole trace
    When I open the "Add to Dataset" drawer on that trace
    Then the annotations the mapping reads include the one left on the span

  @unit
  Scenario: The readable annotation names the part of the trace it is about
    Given a comment left on the output of a span named "web_search"
    When that annotation is read into the ai_readable column
    Then the column names the span, its id and the field the comment was left on

  @unit
  Scenario: A comment about the trace's own field names the trace by id
    Given a comment left on the output of a trace
    When that annotation is read into the ai_readable column
    Then the column names the trace with enough id to find it again

  @unit
  Scenario: A comment about the whole trace reads with no part named
    Given a comment left on a trace rather than on any part of it
    When that annotation is read into the ai_readable column
    Then the column reads as the author and their comment, with no part named

  @unit
  Scenario: A comment left on a message reads as a message
    Given a comment left on one message of a conversation
    When that annotation is read into the ai_readable column
    Then the column says the comment is about a message

  # ============================================================================
  # What one readable annotation carries
  # ============================================================================

  @unit
  Scenario: The readable annotation carries author, part, score and comment in one line
    Given a reviewer left a comment, a thumbs rating, a score with a reason and a suggested output
    When that annotation is read into the ai_readable column
    Then one line carries the author, the part of the trace, the comment, the rating, the score and the suggestion

  @unit
  Scenario: A score reads by its name, not by its id
    Given a reviewer scored a trace against a score named "goodness"
    When that annotation is read into the ai_readable column
    Then the column names the score "goodness" rather than its id

  @unit
  Scenario: A reviewer with no account name reads by their email
    Given a comment left by someone who has no account name
    When that annotation is read into the ai_readable column
    Then the column names them by their email

  @unit
  Scenario: A comment spanning several lines stays on one line
    Given a comment written across several lines
    When that annotation is read into the ai_readable column
    Then the column holds it as a single line

  @unit
  Scenario: Every annotation on the trace gets its own readable line
    Given a trace two reviewers commented on
    When the trace is converted to dataset rows with an ai_readable column
    Then the column holds one text with a line per annotation, not a list of them
    And a rule between them tells one review from the next at a glance
    And a row carrying a single review has no rule in it

  # ============================================================================
  # The whole annotation, when the column takes all of it
  # ============================================================================

  @unit
  Scenario: The whole annotation carries what the reviewer left and nothing else
    Given a reviewer who left only a comment on a span
    When the trace is converted to dataset rows with a whole-annotation column
    Then the row carries the author, the part and the comment
    And it carries no field for the rating, the scores or the suggestion they never left

  @unit
  Scenario: The whole annotation reads in the same words as the single columns
    Given a reviewer who rated a trace, scored it and suggested a better output
    When the trace is converted to dataset rows with a whole-annotation column
    Then the row names the author, the rating, the scores by name and the suggestion
    And it carries none of our storage: no ids of ours, and no email standing in for the author

  @unit
  Scenario: A suggestion for an input is not read as the expected output
    Given a reviewer who suggested what the input should have been
    When the trace is converted to dataset rows with a whole-annotation column
    Then the row carries it as a suggested input, leaving the expected output alone

  # ============================================================================
  # What a new dataset is set up with
  # ============================================================================

  @integration
  Scenario: A new dataset ends with an annotations column
    Given I am creating a new dataset from the "Add to Dataset" drawer
    When the drawer proposes the columns
    Then the last proposed column is named "annotations" and holds a string

  @integration
  Scenario: The annotations column is mapped to the readable annotation by default
    Given a new dataset whose last column is named "annotations"
    When the mapping is set up for it
    Then that column is mapped to the annotations source and its ai_readable field

  @integration
  Scenario: A new dataset does not split into one row per annotation
    Given a new dataset whose annotations column is mapped by default
    When the mapping is set up for it
    Then the "One row per annotation" expansion is off, so a trace stays one row
