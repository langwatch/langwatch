@traces @pagination
Feature: Trace list page size cap
  As a platform operator
  I want every trace list read bounded
  So that no caller can make the backend buffer an unbounded page in memory

  # ─── Design Context ────────────────────────────────────────────────
  #
  # A trace list read buffers its whole page in backend memory and in
  # ClickHouse, so an unbounded pageSize is a memory lever any caller can pull
  # (#8479).
  #
  #   - UI list reads (getAllForProject) refuse above the caller's plan bound
  #   - downloads are a deliberate bulk read: refused above the plan's download
  #     bound (10 000 on every plan, also their default)
  #   - the public REST search routes clamp instead of rejecting, so existing
  #     API clients that ask for more keep working
  #   - the filtered annotations page needs more than one page of trace ids, so
  #     it follows scrollId, at most 10 pages (the old 10 000-trace ceiling)
  #     and only shows ids once the whole walk finished without a failure

  @unit
  Scenario: A trace list read above the caller's plan bound is refused by name
    Given the caller's plan bounds a trace list page at 1000
    When a trace list is read with pageSize 1001
    Then the read is refused with "trace_page_size_too_large" naming the bound 1000
    And a read with pageSize 1000 is accepted

  @unit
  Scenario: A paid plan keeps its larger trace list page
    Given the caller's plan bounds a trace list page at 2000
    When a trace list is read with pageSize 2000
    Then it is accepted
    And a read with pageSize 2001 is refused with "trace_page_size_too_large"

  @unit
  Scenario: A trace download above the plan's download bound is refused by name
    Given the caller's plan bounds a trace download page at 10 000
    When a trace download is requested with pageSize 10 000
    Then it is accepted
    And a download with pageSize 10 001 is refused with "trace_page_size_too_large"

  @unit
  Scenario: Public trace search clamps an oversized page instead of rejecting it
    When the public trace search is called with pageSize 5000
    Then the request is accepted

  @integration
  Scenario: The filtered annotations list walks trace pages at the cap
    Given filters match more traces than one page holds
    When the annotations page collects trace ids
    Then it follows the scrollId until none is returned
    And it reads at most 10 pages

  @integration
  Scenario: A failed trace page never shows a partial annotations list
    Given a later trace page fails to load
    When the annotations page collects trace ids
    Then no trace ids are used
    And the failure is reported

  @integration
  Scenario: The filtered annotations list reads the filters analytics lends
    Given the address carries a trace filter and a period
    When the annotations page asks the shell for the applied trace filters
    Then analytics answers the filters with the period's start and end
    And the answer carries no project id

  @integration
  Scenario: A free-text query alone leaves the annotations list unfiltered
    Given the address carries a search query and no trace filter
    When the annotations page asks the shell for the applied trace filters
    Then no filters are applied

  @integration
  Scenario: A composition with no trace filters lender reads as unfiltered
    Given no module lent the trace filters capability
    When a screen asks for the applied trace filters
    Then no filters are applied
