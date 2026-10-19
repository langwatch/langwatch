Feature: Event appends to one organisation's server fold into shared inserts
  As the event store every job appends through
  I want appends that wait for the same ClickHouse server to leave together in one insert
  So that a run recording a fact per tenant (an upgrade step over every user) is not held to
  one flushed insert per job (Alex, 2026-10-12: the insert tenant set, option A)

  Each insert still waits for ClickHouse to flush it before it answers. An organisation holds
  a few inserts at once; an append that finds one free goes out alone, exactly as before, and
  appends that arrive while all are busy fold into the next one, which declares their tenant set
  (the guard and the router hold it to one organisation, as for a read). The organisation comes
  from the directory the routed member places tenants with.

  @unit
  Scenario: Appends that wait while their organisation's inserts are busy leave as one insert
    Given an organisation whose inserts are all in flight
    When appends of several of its tenants arrive
    Then they leave together in one insert declaring exactly those tenants
    And each append answers only once that insert has been flushed

  @unit
  Scenario: An append that finds a free insert goes out alone
    Given an organisation with no insert in flight
    When one append arrives
    Then it is inserted alone for its own tenant, declaring no tenant set

  @unit
  Scenario: Appends of different organisations never share an insert
    Given two organisations whose inserts are all in flight
    When appends of each arrive
    Then each organisation's appends leave in an insert of their own

  @unit
  Scenario: A shared insert that fails is retried as each append alone
    Given appends folded into one shared insert
    When the shared insert fails
    Then each append is inserted alone
    And an append whose own insert fails fails only its own job, the others succeed
