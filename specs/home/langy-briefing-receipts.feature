# Retired 2026-09-05: main removed the receipts rail in favour of the attention
# inbox (HomeBriefingSection: it only repeated the sidebar); no test on main bound
# these titles. The one scenario the overview card still honours remains.
# Renamed from `langy-briefing.feature` when the platform application's second
# specs root merged into this one. `langy-briefing.feature` is a different
# feature that happened to share the filename: it covers the attention inbox's
# ordering and evidence rules. This one covers the receipts the briefing
# derives and the rail they are shown in.
Feature: Langy's home briefing reads real problem-case signals
  As a returning user landing on the project home
  I want Langy's briefing to surface the traces and runs that actually need a look
  So that I start from real receipts, not vanity metrics or invented numbers

  # ---------------------------------------------------------------------------
  # The briefing derives a "Needs a look" list from the project's REAL analytics
  # and scenario runs. Every receipt links to the filtered view that proves it.
  # Where a signal has no real source, the receipt is OMITTED — never faked
  # (honest degradation).
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Refetching does not wipe the overview card
    Given the overview card is showing cached data
    When the underlying queries refetch in the background
    Then the previous data stays on screen
    And only a subtle refreshing hint is shown, not a full skeleton swap
