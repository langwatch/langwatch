Feature: The clickhouse-serverless image renders every server setting from env
  The image's config renderer is the only writer of the files it names in
  config.d and users.d. Each tunable setting has one env var with a default,
  so a deployment runs the public image by setting env and mounting extra
  files, never by patching the image.

  @unit
  Scenario: Server and profile settings render their defaults
    Given no env var sets them
    When the renderer writes the server configuration
    Then the default profile compresses inter-server traffic with zstd at level 3
    And the default profile cancels a read-only HTTP query when its client goes away
    And SELECT queries get no admission cap of their own
    And no byte cap is set on a merge block

  @unit
  Scenario: Each server and profile setting follows its env var
    Given env vars set the merge block byte cap, the SELECT admission cap, the network compression method and level, and HTTP read cancellation
    When the renderer writes the server configuration
    Then each setting carries the value its env var gave

  @unit
  Scenario: Pool-entry thresholds follow an overridden background pool size
    Given BACKGROUND_POOL_SIZE overrides the pool size computed from CPU
    When the renderer writes the server configuration
    Then each free-entry threshold not set by its own env var is derived from the overridden pool size
    And a threshold set by its own env var keeps that value

  @unit
  Scenario: Interserver credentials are rendered only from a password file
    Given CLICKHOUSE_INTERSERVER_PASSWORD_FILE names a mounted secret
    When the renderer writes the server configuration
    Then replicas authenticate part fetches with CLICKHOUSE_INTERSERVER_USER and that password
    And a later run without the password file removes the credentials it wrote

  @unit
  Scenario: The server logs to the console only unless file logging is asked for
    Given LOG_TO_FILE is not set
    When the renderer writes the server configuration
    Then the image's file and error-file loggers are removed
    And with LOG_TO_FILE=true they are kept

  @unit
  Scenario: The default user can be left without access management
    Given DEFAULT_USER_ACCESS_MANAGEMENT is false
    When the renderer writes the server configuration
    Then no file it writes grants the default user access_management or named_collection_control

  @unit
  Scenario: Files a deployment mounts next to the rendered ones are left alone
    Given a deployment has mounted its own files into config.d and users.d
    When the renderer writes the server configuration, with optional files on and then off
    Then every mounted file is still there, unchanged
