Feature: The legacy REST families keep the remediation channel

  The families that publish the flat `{ error, message }` body used to ship
  the remediation channel alongside it: the tips an agent follows when it has
  no presentation registry, the documentation link, the fault that says who
  can act, and the reasons chain.

  Dropping the chain is the load-bearing half. A refusal carrying a LIST of
  facts — one reason per offending field of a rejected schema — becomes a
  single sentence saying something was wrong with no way to learn what.

  The customer-safe rule is unchanged: a handled error's fields are all
  customer-safe by definition, `serialize` masks a non-handled cause as
  unknown, and an unanticipated failure still collapses to the generic 500.

  @unit
  Scenario: A handled refusal ships its tips and documentation link
    Given a legacy REST family whose route raises a handled refusal with remediation copy
    When a caller reaches that route
    Then the body carries the refusal's tips
    And the body carries the refusal's documentation link

  @unit
  Scenario: A handled refusal says who can act on it
    Given a legacy REST family whose route raises a refusal attributed to the platform
    When a caller reaches that route
    Then the body says the fault is the platform's

  @unit
  Scenario: A refusal made of several facts ships all of them
    Given a legacy REST family whose route raises a refusal carrying one reason per rejected field
    When a caller reaches that route
    Then the body carries a reason for each rejected field

  @unit
  Scenario: An unanticipated cause behind a handled refusal stays masked
    Given a legacy REST family whose route raises a handled refusal caused by a dropped database connection
    When a caller reaches that route
    Then the cause is reported as unknown
    And the body names no internal detail of that cause
