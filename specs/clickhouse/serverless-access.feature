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
    And a full cache drops expired tokens first, then the one expiring soonest, and never serves an expired one

  @unit
  Scenario: A token stops working the moment it expires
    Given a token user's token that expires at an instant
    When it is presented a second before that instant, and at it
    Then it is accepted before and refused at the instant, from cache and verified afresh
    And not-before still allows 30 seconds of clock leeway

  @unit
  Scenario: The sidecar is ready only once it can decide token logins
    Given the sidecar has no access file, or an issuer whose keys it has never fetched
    When readiness is asked
    Then it answers 503 naming what is missing
    And once every issuer's keys were fetched it answers 200
    And it stays ready, and keeps accepting tokens, while an issuer is unreachable later

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

  # Dynamic-only mode (ADR-184 section 7): tokens only, nothing static to steal.

  @unit
  Scenario: Dynamic-only mode refuses every long-lived password in access.yaml
    Given an access file with mode dynamic-only
    When it declares a rolling user, a user named local_admin or default, or an admin token user whose issuer does not allow admins
    Then loading it fails, naming each offending user
    And the same rolling user loads in standard mode

  @unit
  Scenario: Dynamic-only mode starts without any password for the default user
    Given an access file with mode dynamic-only and neither CLICKHOUSE_PASSWORD nor CLICKHOUSE_PASSWORD_FILE
    When ch-config loads and validates its input
    Then it starts in dynamic-only mode

  @unit
  Scenario: Dynamic-only mode refuses a long-lived password for the default user
    Given an access file with mode dynamic-only
    When CLICKHOUSE_PASSWORD or CLICKHOUSE_PASSWORD_FILE is set, the bootstrap directory is relative, or replicas run without the cluster secret
    Then ch-config fails with a message naming the setting

  @unit
  Scenario: Dynamic-only mode renders no password a client could hold
    Given a dynamic-only server
    When the renderer writes the server configuration
    Then only default and local_admin carry a password, and only as a hash
    And default has an empty network list and the hash of a secret nobody keeps, new at every start
    And no-password and plaintext logins and new SQL passwords are refused server-wide

  @unit
  Scenario: Dynamic-only mode refuses a users.d file with a long-lived password
    Given a dynamic-only server
    When users.xml, users.d or conf.d gives a user a password, no_password or ssh_keys login, such as the rendered LangWatchQL user
    Then the server refuses to start, naming each file and user
    And LDAP, Kerberos, certificate and token users are allowed

  @unit
  Scenario: Every server start gives the local admin a new password that never leaves the pod
    Given a dynamic-only server
    When it starts
    Then a random password is written to the bootstrap tmpfs, readable by uid and group 101 only
    And users.d holds only its hash
    And the next start replaces it, and the old password no longer matches
    And leaving dynamic-only mode removes the local admin and its password
    And in-pod helpers re-read it for every query

  @unit
  Scenario: The local admin logs in from loopback only
    Given the rendered local admin
    Then its networks are 127.0.0.1 and ::1, replacing any other definition

  @unit
  Scenario: Initialisation scripts log in as the local admin in dynamic-only mode
    Given a dynamic-only server with initdb scripts
    When the entrypoint starts the official entrypoint
    Then the scripts get local_admin and this start's password
    And without initdb nothing is handed on

  @unit
  Scenario: The sidecar never switches mode while the server runs
    Given the server started in one mode
    When access.yaml switches to the other
    Then the sidecar keeps the last rendered users and logs that a restart is needed

  @unit
  Scenario: The sidecar reports any password login left on a dynamic-only server
    Given a dynamic-only server with a SQL user created with a password
    When the sidecar audits system.users as the local admin
    Then it logs an error naming the user, once per change, and drops nothing

  @unit
  Scenario: The chart runs a dynamic-only pod with no static password mounted
    Given access.dynamicOnly.enabled
    When the chart is rendered
    Then neither container gets the default password, and a single pod mounts no credentials Secret
    And both containers share an in-memory bootstrap volume
    And the sidecar's readiness gates the pod, and replicated probes log in as local_admin
    And the chart refuses it without access, with password Secrets, with backups, or with replicas but no cluster secret

  @integration
  Scenario: A dynamic-only server accepts short-lived tokens and no password
    Given the image runs in dynamic-only mode with an OIDC issuer
    When users log in over HTTP and over the native protocol
    Then no password logs in, not default's with any password nor local_admin's from outside loopback
    And a token gets exactly its tier's rights and fails the moment it expires
    And a wrong audience, issuer or key, or another user's token, is refused
    And a rotated issuer key works mid-run, and new logins return soon after the sidecar restarts
    And a server restart rotates the local admin password

  @integration
  Scenario: A real ClickHouse honours tiers, rolling passwords and token logins
    Given the image runs with an access file, a rolling read user with two passwords and a token user
    When each logs in over HTTP and over the native protocol
    Then both passwords and a fresh token are accepted, an expired token is refused
    And the read user can select from its database but cannot insert or read system.query_log
