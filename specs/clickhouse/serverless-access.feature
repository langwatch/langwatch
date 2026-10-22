Feature: clickhouse-serverless gives every login a tier, rotates passwords and accepts OIDC tokens
  As an operator running the public clickhouse-serverless image
  I want named privilege tiers, passwords I can rotate with two valid at once,
  and short-lived logins from the identity provider I already run
  So that nobody shares the admin password and nothing ships with a default one,
  while a server that has none of this configured behaves as it did before

  # ADR-184 (dev/docs/adr/184-clickhouse-serverless-access-tiers-rolling-passwords-and-token-logins.md).
  # access.yaml users are rendered into users.d and kept current by `ch-config sidecar`.

  @unit
  Scenario: The server refuses to start without a password for the default user
    Given neither CLICKHOUSE_PASSWORD nor CLICKHOUSE_PASSWORD_FILE gives a password
    When ch-config validates its input
    Then it fails and names both variables

  @unit
  Scenario: A published or blank-looking default password starts with a warning
    Given the default user's password is langwatch, clickhouse, password, default or only whitespace
    When ch-config validates its input and renders the configuration
    Then the server still starts
    And a warning at every boot says how to set CLICKHOUSE_PASSWORD

  @unit
  Scenario: A server without access renders no tiers
    Given no access file and CLICKHOUSE_ACCESS_TIERS not set
    When the renderer writes the server configuration
    Then no tier role or profile, access user or token auth server is rendered

  @unit
  Scenario: Tiers are rendered with an access file or CLICKHOUSE_ACCESS_TIERS
    Given an access file, or CLICKHOUSE_ACCESS_TIERS=true for operator-written users
    When the renderer writes the server configuration
    Then the roles and profiles tier_inspect, tier_read, tier_write and tier_admin exist
    And the read tiers run with readonly=2 and cannot raise their execution time or memory caps

  @unit
  Scenario: Turning the access file off removes what it rendered
    Given a server rendered with an access file
    When it is rendered again without one
    Then the access users, the token auth server and the tiers are gone

  @unit
  Scenario: An invalid access file stops the server from starting
    Given an access file with an unknown key, an unknown tier or issuer, a duplicate user, a reserved user name, a bad network, a missing password directory, or an admin token user whose issuer does not allow admins
    When ch-config loads it
    Then it fails with an error naming the offending entry

  @unit
  Scenario: A user gets its tier's grants on its own databases only
    Given a read user and a write user, each listing one database
    When the access users are planned
    Then the read user may select from its database and nothing else
    And the write user may also insert, update and delete there, but not run DDL
    And each user runs under its tier's profile and network list

  @unit
  Scenario: Two passwords in a rolling directory are valid at once
    Given a rolling user whose directory holds two password files
    When the access users are planned
    Then the user has one password method per file

  @unit
  Scenario: A password past its valid_until stops working at the next sync
    Given a password file with a valid_until instant that has passed
    When the access users are planned
    Then that password is no longer one of the user's methods
    And the sidecar plans again no later than the next valid_until

  @unit
  Scenario: A rolling user whose passwords have all expired cannot log in
    Given every password of a rolling user is past its valid_until
    When the access users are planned
    Then the user is left out and a warning says why

  @unit
  Scenario: The sidecar keeps the last good file when an input cannot be read
    Given the sidecar has rendered the access users
    When a password directory disappears or the access file becomes invalid
    Then the rendered file is left unchanged and the error is logged
    And once the input is readable again the next sync applies it

  @unit
  Scenario: A token login is accepted for the user its claim names
    Given a token user bound to an issuer and a subject
    When ClickHouse asks the sidecar about a token signed by that issuer for that subject and audience
    Then the sidecar answers 200

  @unit
  Scenario: A token is refused unless every check passes
    Given a token user bound to an issuer and a subject
    When the token is expired, not yet valid, for another audience, from another issuer, for another subject, unsigned, HMAC-signed, signed by an unknown key, missing a required claim, or presented for a password user
    Then the sidecar answers 401

  @unit
  Scenario: A rotated issuer signing key is picked up without a restart
    Given the sidecar has fetched an issuer's keys
    When the issuer starts signing with a new key
    Then a token signed with the new key is accepted after one refetch
    And a flood of unknown key ids refetches at most once per interval

  @unit
  Scenario: A verified token is answered from cache until it expires
    Given the sidecar has accepted a token
    When the same user presents it again before it expires
    Then the sidecar answers without verifying it again
    And after it expires, or after the access file changes, the token is verified afresh

  @unit
  Scenario: The sidecar listens on loopback only
    Given CLICKHOUSE_ACCESS_LISTEN names a non-loopback address
    When ch-config loads its input
    Then it fails

  @unit
  Scenario: The chart runs no access sidecar unless asked
    Given the chart's default values
    When it is rendered
    Then the ClickHouse pod has one container, no access file and no access ConfigMap

  @unit
  Scenario: With access enabled the chart wires the sidecar, the access file and the password Secrets
    Given access.enabled with an access file and a password Secret
    When the chart is rendered
    Then ClickHouse and the sidecar both mount the access file and the Secret
    And they share users.d, and ClickHouse runs no embedded sidecar

  @unit
  Scenario: The deprecated users value is accepted and warned about
    Given a values file that still sets the chart's users value
    When the chart is rendered
    Then it renders as without it, and the install notes say users is deprecated

  @integration
  Scenario: A real ClickHouse honours tiers, rolling passwords and token logins
    Given the image runs with an access file, a rolling read user with two passwords and a token user
    When each logs in over HTTP and over the native protocol
    Then both passwords and a fresh token are accepted, an expired token is refused
    And the read user can select from its database but cannot insert or read system.query_log
