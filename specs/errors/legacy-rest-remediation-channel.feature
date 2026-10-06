Feature: The legacy REST families keep the remediation channel

  The legacy families publish the same flat root body as every other family
  (`type`, `code`, `message` at the root, nothing nested under `error`) and
  ship the remediation channel alongside it: the tips an agent follows when it has
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

  # An API-key ceiling denial is the refusal with tips and a docs link: the
  # door renders it through the same envelope as every other handled refusal.

  @unit
  Scenario: An API-key ceiling denial carries the same channel
    Given an API key that does not grant the permission a route requires
    When a caller reaches that route
    Then the denial carries the tips for re-scoping the key
    And it carries the documentation link for creating one
    And it says who can act on it

  @unit
  Scenario: An API-key ceiling denial carries no identifier fields
    Given an API key that does not grant the permission a route requires
    When a caller reaches that route
    Then the denial body carries no apiKeyId, userId or projectId field

  @unit
  Scenario: An unanticipated cause behind a handled refusal stays masked
    Given a legacy REST family whose route raises a handled refusal caused by a dropped database connection
    When a caller reaches that route
    Then the cause is reported as unknown
    And the body names no internal detail of that cause

  # Every `tips` / docs link an error class emits lives in one registry keyed
  # by code (`@langwatch/handled-error`'s remediation registry), so the copy a
  # customer reads is written once. A class that inlines its own copy — or
  # spreads nothing at all — quietly answers a refusal with no next step, and
  # nothing in the type system notices.

  @unit
  Scenario: A missing API key names the two ways to find the right id
    Given a caller revokes an API key id that does not exist
    When the refusal is rendered as the flat legacy body
    Then the body carries the tips for checking and listing the key ids
    And the body carries the documentation link for API keys
