# Skill Invocation Highlight — Gherkin Spec
# Covers: promoting coding-agent skill runs in the trace UI so a reader can
#         see at a glance when a skill (e.g. /surf-pr) was invoked, distinct
#         from ordinary tool calls (Bash, Edit, …).
#
# Background: coding agents run a loaded skill through a built-in tool named
# `Skill` — a `tool_use` block whose input carries the skill slug. The
# block-cost classifier already treats this as a distinct `skill_invocation`
# category (the coding-agent cost-intelligence ADR, on a separate branch);
# the trace UI mirrors that recognition.

Feature: Skill invocation highlight

Rule: The conversation transcript promotes a skill run
  A `Skill` tool_use renders with its own glyph and accent and names the
  invoked skill, instead of the generic tool-call card.

  Scenario: A skill run shows the invoked skill name
    Given an assistant turn contains a `tool_use` named "Skill" with input `{ "skill": "surf-pr" }`
    When the transcript renders the turn
    Then the tool card header reads "Skill · surf-pr"
    And the card uses the skill glyph and accent, not the generic tool wrench

  Scenario: A skill run without a resolvable slug falls back to a bare label
    Given an assistant turn contains a `tool_use` named "Skill" with empty input
    When the transcript renders the turn
    Then the tool card header reads "Skill"
    And the card still uses the skill glyph and accent

  Scenario: An ordinary tool call is not treated as a skill
    Given an assistant turn contains a `tool_use` named "Bash" with input `{ "command": "ls" }`
    When the transcript renders the turn
    Then the tool card header reads "Bash"
    And the card uses the generic tool wrench and shows the command summary

Rule: The span waterfall flags skill spans
  A `Skill` tool span reads as a skill in the span tree — the node carries no
  input, so it is flagged (glyph + accent + type label) without naming the skill.

  Scenario: A skill span is flagged in the tree
    Given a trace has a tool span named "Skill"
    When the waterfall renders
    Then that span row uses the skill glyph and purple accent
    And its tooltip labels the span type as "SKILL"

  Scenario: Repeated skill spans keep the skill accent when folded
    Given a trace has five or more sibling tool spans named "Skill"
    When the waterfall folds them into an "×N repeated" group row
    Then the group row keeps the purple skill accent

Rule: The waterfall's timeline pane agrees with its tree pane
  The tree row and timeline bar are two halves of the same waterfall row —
  the timeline pane must not disagree with the tree pane's skill accent.

  Scenario: A skill span's timeline bar matches its tree row's accent
    Given a trace has a tool span named "Skill"
    When the waterfall renders
    Then that span's timeline bar uses the purple skill accent, matching its tree row

  Scenario: A folded skill group's timeline bar matches its group row's accent
    Given a trace has five or more sibling tool spans named "Skill"
    When the waterfall folds them into an "×N repeated" group row
    Then the group's timeline bar keeps the purple skill accent, matching its group row
