# Implementation:
#   langwatch/src/features/traces-v2/utils/leadingContext.ts
#   langwatch/src/features/traces-v2/utils/previewFormatter.ts (list preview)
#   langwatch/src/features/traces-v2/components/TraceDrawer/transcript/BlockStack.tsx (pretty mode)

Feature: Prepended context collapse

  Coding agents such as Claude Code stack large blocks of machine context
  (a system reminder, MCP instructions, a skills list) above the first line
  the human actually typed. In the trace list that boilerplate fills the
  whole preview, so the real message ("hi", "what is 2+2?") never shows; in
  the pretty conversation view the human text is buried under a wall of XML.

  The product separates those leading context blocks from the human text so
  the message a person sent reads first. This is a display-only treatment:
  the stored span is never rewritten, and the full context stays one click
  away.

Rule: Leading context blocks are separated from the human message

  A context block is a complete tag pair (<system-reminder>…</system-reminder>
  and friends) at the very front of the message. Only the run of blocks before
  the first human text is treated as context.

  Background:
    Given an agent message that begins with one or more context blocks
    And the human text follows those blocks

  @unit
  Scenario: Leading agent context is separated from the human message
    When the message is rendered
    Then the context blocks are held apart from the human text
    And the human text is what the reader sees first

  @unit
  Scenario: Tags that follow the human text are left untouched
    Given a message whose human text comes first and contains tags later on
    When the message is rendered
    Then nothing is treated as leading context
    And the message is shown exactly as written

  @unit
  Scenario: A context-only message stays visible instead of blanking
    Given a message that is only a context block with no human text after it
    When the message is rendered
    Then the context is still shown rather than collapsing to an empty preview

Rule: Each surface presents the separated context differently

  @unit
  Scenario: The trace list preview shows the human text, not the boilerplate
    Given a trace whose first message has context stacked above "hi"
    When the trace list renders its input preview
    Then the preview shows the human text
    And it does not show the leading context boilerplate

  @integration
  Scenario: Prepended context is collapsed behind a disclosure in pretty mode
    Given a trace open in the drawer in pretty mode
    And the first message has context stacked above the human text
    Then the human text renders normally
    And the context is collapsed behind a "Hidden additional context" disclosure
    And expanding the disclosure reveals the full context
