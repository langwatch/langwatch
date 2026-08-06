# Conversation view — one notice when content was redacted
#
# Implementation:
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/ConversationView.tsx
#   platform/app/src/components/ui/PIIRedactionNotice.tsx  (the shared alert, its copy and its settings link)
#
# Motivation: a project's privacy settings replace matched personal data and
# secrets in place with a typed marker ([EMAIL_ADDRESS], [SECRET], ...). A
# reader who does not know that reads the gaps as the payload having been lost,
# and has no way to reach the setting that caused them. The legacy thread view
# says so once per message card; a conversation is many turns under one
# project policy, so the conversation view says it once, above the turns.
#
# Left out of the conversation view deliberately, both carried by the legacy
# thread view:
#   - the privacy-dropped notice naming whole categories a policy dropped: it
#     is trace-level state and the conversation's turn data does not carry the
#     dropped categories.
#   - pretty-printing a JSON message payload: the conversation renders the
#     extracted prose of each message, and the raw payload stays one tab away
#     in the drawer.

Feature: Conversation redaction notice

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open on a conversation

  Rule: The conversation says once that content was redacted

    @integration
    Scenario: A conversation carrying a redaction marker shows the notice
      Given one turn's message carries a redaction marker
      Then a notice above the turns says content was redacted by the project's privacy settings
      And it links to the data-privacy settings page

    @integration
    Scenario: Several redacted turns still show one notice
      Given three turns carry redaction markers
      Then exactly one notice is shown for the whole conversation

    @integration
    Scenario: A conversation with no markers shows no notice
      Given no turn's message carries a redaction marker
      Then no redaction notice is shown

    @integration
    Scenario: Ordinary bracketed text does not raise the notice
      Given a turn whose message contains "[INFO] the job started"
      Then no redaction notice is shown
