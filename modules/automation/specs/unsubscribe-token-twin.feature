Feature: The unsubscribe token and no-reply address as one shared format

  Every automation email carries two strings a second process has to read back:
  a per-recipient unsubscribe token in the footer, and a hashed no-reply
  address in the `To:` header. The token is verified by the application's
  public `/unsubscribe` route, without a login, months after it was minted; the
  address is what a bounce processor attributes a bounce by.

  Once mail can leave a background process as well as the application, the two
  sides of each format are in different codebases. So both live in the feature
  that owns their meaning: a recorded token the application signed verifies
  here, and a token signed here keeps the shared fields in the shared order.

  A footer link is the authorization to suppress someone's mail, so it does
  not live forever: a link carries its expiry, and a link minted before links
  carried one stops working on a fixed date.

  The two behave differently on an absent key, deliberately. The token IS the
  authorization — a forgeable one lets anyone suppress anyone's mail — so it
  fails closed. The no-reply tag carries no authority at all, so it degrades
  and says so rather than blocking every automation email a deployment sends.

  @unit
  Scenario: A token the application signed verifies here
    Given the signing key both processes share
    When this feature verifies a token recorded from the application
    Then it reads back the project, the automation and the recipient

  @unit
  Scenario: A token this feature signs keeps the shared format and carries its expiry
    Given the signing key both processes share
    When this feature signs a footer link for one recipient
    Then the token carries the project, the automation and the recipient in the shared order
    And it carries the instant it stops working

  @unit
  Scenario: A link stops working once its lifetime has passed
    Given a link signed today
    When its lifetime has passed
    Then verification refuses

  @unit
  Scenario: A link minted without an expiry works until a fixed date
    Given a link minted before links carried an expiry
    When it is opened before the cut-off date
    Then it verifies
    When it is opened on or after the cut-off date
    Then verification refuses

  @unit
  Scenario: The address is bound to the recipient it was minted for
    Given a token signed for one recipient
    When any field in it is altered
    Then verification refuses

  @unit
  Scenario: An absent signing key refuses to mint or verify a token
    Given no signing key
    When a footer link is signed
    Then it is refused naming the setting the operator must supply

  @unit
  Scenario: The no-reply address is stable per automation
    Given the signing key both processes share
    When a no-reply address is built for an automation
    Then it is byte for byte the one the application produces
    And the same automation always produces the same address

  @unit
  Scenario: An absent signing key degrades the no-reply address rather than blocking
    Given no signing key
    When a no-reply address is built for an automation
    Then an address is still produced
    And the caller is told the address is no longer unguessable
