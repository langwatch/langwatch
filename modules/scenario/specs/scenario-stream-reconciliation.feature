Feature: Streamed scenario messages settle against the stored run
  As a LangWatch user watching a scenario run live
  I want streamed message text to stay until the stored run agrees with it
  So that I never see blank, partial, stale or rolled-back messages

  # The SDK streams START, CONTENT and END for each message; START and END are
  # stored, CONTENT is broadcast only. The drawer shows a preview from the
  # stream and drops it once the stored run holds the same text, the run
  # finishes, or a stored message snapshot replaces the conversation.

  @integration
  Scenario: A message keeps streaming while the stored run lags behind
    Given a message is streaming into the run drawer
    When the stored run returns the message's empty START row
    Then later deltas keep extending the streamed preview

  @integration
  Scenario: Final text survives an empty stored START row
    Given a streamed message has ended
    When the stored run still holds only its empty START row
    Then the drawer keeps showing the streamed final text

  @integration
  Scenario: Final text stays until the stored text matches it
    Given a streamed message has ended
    When a lagging read holds only part of its text
    Then the drawer keeps showing the streamed final text
    And the preview goes once the stored text matches it

  @integration
  Scenario: A stored message snapshot drops every preview of the run
    Given a completed preview the SDK has since rolled back
    When the server reports a stored message snapshot for the run
    Then the preview is dropped at once, without a later START or a finished run

  @unit
  Scenario: A stored message snapshot frame refetches the run
    When the drawer receives a stored message snapshot frame
    Then it refetches that run's stored state

  @unit
  Scenario: Storing a message snapshot broadcasts a reset frame
    When the SDK posts a message snapshot
    Then viewers receive a structural reset frame naming the run and batch

  @integration
  Scenario: A finished run drops previews that never landed
    Given an aborted streaming preview and a rolled-back completed preview
    When the stored run finishes
    Then neither preview is shown

  @integration
  Scenario: Switching runs never shows the previous run's previews
    Given a preview is streaming for one run
    When the drawer switches to another run
    Then no preview of the first run is shown

  @unit
  Scenario: A START inserts beside earlier previews, never truncating
    Given a completed preview at a message index
    When another message starts at the same index
    Then both previews are kept
