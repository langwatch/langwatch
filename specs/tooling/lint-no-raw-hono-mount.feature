Feature: The no-raw-hono-mount lint rule
  A route registers through `app.access(policy)`, never on the raw Hono app
  behind a SecuredApp — the raw app skips the access policy entirely.

  @unit
  Scenario: A raw Hono mount is reported
    Given a source file that registers a verb on app.hono directly
    When the no-raw-hono-mount rule runs over it
    Then it reports rawMount

  @unit
  Scenario: Mounting through app.access is left alone
    Given a source file that registers a verb through app.access(policy)
    When the no-raw-hono-mount rule runs over it
    Then it reports nothing
