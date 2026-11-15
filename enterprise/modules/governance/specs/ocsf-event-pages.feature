Feature: governance_ocsf_events pages cost the page
  A pull run writes its kept events to governance_ocsf_events, and the SIEM
  export and the activity drawer read them back a page at a time. Both sides
  should cost what one page costs: a few INSERT statements for a pulled page,
  and a read bounded by the page's keys and months rather than the tenant's
  whole history.

  Companion: specs/ai-gateway/governance/folds.feature, siem-export.feature.

  Rule: a pulled page is written to governance_ocsf_events in a few statements

    @unit
    Scenario: A page of pulled events reaches the OCSF table in chunked inserts, not one per event
      Given a pull run kept 1,000 events
      When the run writes its audit rows
      Then ClickHouse receives 2 INSERT statements of at most 500 rows each
      And every kept event lands as one OCSF row

    @unit
    Scenario: An event a pulled page repeats is written once, as its last copy
      Given a pull run kept two copies of the same provider event
      When the run writes its audit rows
      Then the OCSF table receives one row for that event
      And the row carries the copy the provider sent last

    @unit
    Scenario: A pulled page too large to spread into Math.min still finds its unpriced window
      Given a pull run dropped the price of 200,000 events
      When the run records its unpriced window and how far it read
      Then the window spans the earliest to the latest dropped event
      And the newest of the page's times is found the same way, without a RangeError

  Rule: a SIEM export page costs the page, not the tenant's history

    @integration
    Scenario: A SIEM export page after a cursor does not read the history before it
      Given a tenant holds three months of OCSF events
      When a SIEM client reads one page after a cursor in the last month
      Then ClickHouse reads fewer rows than the tenant stores before the cursor

    @integration
    Scenario: A SIEM export page reads the payload of its own rows only
      Given a tenant holds six months of OCSF events with their payloads
      When a SIEM client reads the first page of the export
      Then ClickHouse reads less than half the payload bytes the tenant stores

    @integration
    Scenario: A rewritten event is exported once, at its newest version, across pages
      Given an OCSF event was written twice, the second time with a new payload
      When a SIEM client pages through the whole export
      Then the event appears on exactly one page
      And it carries the second payload

    @integration
    Scenario: The newest pulled events of a source read the payload of that page only
      Given a source holds six months of pulled OCSF events with their payloads
      When the activity drawer reads its newest page of pulled events
      Then ClickHouse reads less than half the payload bytes the source stores

    @integration
    Scenario: A rewritten pulled event appears once in the activity drawer, at its newest version
      Given a pulled OCSF event was written twice, the second time with a new payload
      When the activity drawer pages through the source's pulled events
      Then the event appears on exactly one page
      And it carries the second payload
