Feature: prose-lint warns when a piece opens with a question
  The writing guide bans an opening question by default and allows one rarely,
  when the answer lands in the same line and the question is the reader's own
  words ("Laptop shut? It still works"). `dev/scripts/prose-lint/lint.mjs`
  flags every opening question as a warning the author has to justify. A
  warning prints with a `w` flag and never fails the run.

  @unit
  Scenario: A question with its answer in the same line is flagged as answered
    Given a page whose H1 is "Laptop shut? It still works"
    When the opener is checked
    Then the question "Laptop shut?" is reported
    And it is marked as answered in the same line

  @unit
  Scenario: A question with no answer in its line is flagged as a windup
    Given a page that opens with "Ever wondered why your bot answers when retrieval is empty?"
    And the answer comes in the next paragraph
    When the opener is checked
    Then the question is reported as not answered in the same line

  @unit
  Scenario: A statement H1 does not hide a question in the first paragraph
    Given a page whose H1 is "Support bots"
    And whose first paragraph opens with "Why did retrieval return nothing?"
    When the opener is checked
    Then the paragraph's question is reported

  @unit
  Scenario: A question that wraps onto a second line is judged by the line holding its mark
    Given a first paragraph whose question starts on one line and ends on the next
    And nothing follows the question mark on that line
    When the opener is checked
    Then the question is reported as not answered in the same line

  @unit
  Scenario: An image wrapper before the first text paragraph is skipped
    Given a page whose first block is a Frame with an image
    And whose first text paragraph opens with a question
    When the opener is checked
    Then the paragraph's question is reported

  @unit
  Scenario: A statement opener and a question later on are not flagged
    Given a page that opens with "The agent forgets because it compacts its context."
    And asks "So why keep it all?" later in the paragraph
    When the opener is checked
    Then nothing is reported
