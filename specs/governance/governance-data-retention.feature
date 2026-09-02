@governance @retention
Feature: How long governance data lives, and what that costs when it goes
  Governance keeps two very different kinds of record, and they expire under
  two different rules. Security events name real people, so they are held for
  a fixed period nobody can extend. Money days are rebuilt from the event log,
  so once the log has aged out there is nothing left to rebuild them from and
  an erasure has to say so.
  Decision: ADR-128 sections 9 and 16.

  @unit
  Scenario: The SIEM event table holds personal data for a fixed period, not a customer-set one
    Given the security event table carries provider display names and email addresses
    Then it expires those rows after a fixed period
    And no customer retention setting can lengthen or shorten that period
    # The table shipped keeping rows forever. Enrolling it in the customer
    # retention machinery would not fix that: applying a retention setting
    # replaces the whole expiry rule in one go, so a customer who asked for a
    # longer window would then be holding names and email addresses past the
    # fixed bound. A holding period for personal data is not a customer
    # setting.

  @unit @integration
  Scenario: Each area is judged against how far its own log reaches
    Given an organization whose spend was recorded in two areas
    And one area's history reaches further back than the other's
    When somebody is erased from both
    Then a day is only reported as unrebuildable when its own area's history
      has aged past it
    # How far back the history reaches is read from the history itself, not
    # worked out from the retention setting. The setting describes what will
    # happen to rows written from now on; it says nothing reliable about the
    # rows already there, which were written under whatever setting was in
    # force then and are removed lazily rather than on the stroke of the
    # deadline.

  @unit @integration
  Scenario: An area whose log cannot be read is retried, not written off
    Given an area whose history cannot be read
    When somebody is erased
    Then every affected day is attempted
    And no day is reported as unrebuildable
    # The two ways of being wrong here are not equal. Attempting a day that
    # cannot be rebuilt costs a wider replay that changes nothing. Writing off
    # a day that could have been rebuilt permanently lowers that day's total
    # and tells the customer it was unavoidable.
