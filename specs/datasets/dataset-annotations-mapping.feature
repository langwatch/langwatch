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
    Then the column names the span and the field the comment was left on

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
    Then the column holds one readable line per annotation

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
