# Input/Output Pretty mode — Markdown for plain text
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/IOViewer.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/IOViewerBody.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/markdownView/RenderedMarkdown.tsx
#
# Motivation (round 5): in the I/O viewer, "Pretty" already does
# something useful for chat transcripts and JSON, but for plain-text
# content (not a conversation, not JSON) it falls through to the same
# monospace pre-wrap as the raw "Text" view — so toggling to Pretty looks
# like a no-op. When that plain text is actually Markdown (a prompt, a
# model answer), Pretty should render it richly.
#
# Decision (round 5): render Markdown in Pretty mode only when the content
# *looks like* Markdown (headings, lists, fenced code, links, emphasis,
# blockquotes, tables). Content that isn't Markdown (log dumps, stack
# traces, whitespace-significant text) keeps today's monospace pre-wrap so
# nothing gets mangled. The raw text is always still reachable via the
# "Text" tab.

Feature: I/O Pretty mode renders Markdown

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open on a span with plain-text input/output
    And the I/O viewer is in "Pretty" mode

  Scenario: Markdown-looking plain text renders rich in Pretty mode
    Given the plain-text content contains Markdown (e.g. a heading and a list)
    Then Pretty mode renders it as formatted Markdown
    And it is visibly different from the raw "Text" view

  Scenario: Non-Markdown plain text keeps monospace pre-wrap
    Given the plain-text content does not look like Markdown (e.g. a log dump)
    Then Pretty mode renders it as monospace pre-wrapped text
    And no Markdown reflow is applied

  Scenario: The raw text remains available
    Given the plain-text content rendered as Markdown in Pretty mode
    When the user switches to the "Text" view
    Then the original, unrendered text is shown

  Scenario: Chat and JSON content are unaffected
    Given the content is a chat transcript or JSON
    Then Pretty mode renders it as it does today (transcript / highlighted JSON)
    And the Markdown path does not apply

  Scenario: An explicit chat_messages envelope with a malformed message still renders as a conversation
    Given the content is an explicit chat_messages typed-value envelope
    And one message in the conversation is malformed
    Then Pretty mode renders the conversation transcript using the valid messages
    And it does not fall back to raw JSON because of the one malformed message
