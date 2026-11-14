Feature: The span-braid-honour-owner lint rule
  Braids reach the ClickHouse fence only on a proof whose braids were honoured,
  and only the trace module's braid pause honours them, after the Enterprise
  plan check (ADR-201 §9). Production code outside that service may not import
  `honourSpanBraids`, and code outside `@langwatch/authorization` may not write
  the `braidsHonoured` flag on an object. Tests are exempt.

  @unit
  Scenario: Honouring braids outside the trace module's braid pause is reported
    Given a trace service that imports honourSpanBraids, or calls it through a namespace import
    When the span-braid-honour-owner rule runs over it
    Then it reports honourOutsidePause naming the function and the file

  @unit
  Scenario: Setting the braids-honoured flag by hand is reported
    Given a service that writes braidsHonoured on an object literal
    When the span-braid-honour-owner rule runs over it
    Then it reports flagByHand, and nothing for reading the flag

  @unit
  Scenario: The trace module's braid pause may honour braids
    Given the braid pause service, the authorization package or a test importing honourSpanBraids
    When the span-braid-honour-owner rule runs over it
    Then it reports nothing
