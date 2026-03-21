Feature: Private Dataplane S3 Routing

  Enterprise customers can have a dedicated S3 bucket for data isolation.
  This covers all app-managed storage: datasets, images, audio, and any
  user-uploaded content (NOT ClickHouse's internal S3 for cold storage).

  Credentials come from environment variables as a JSON config. The env var
  format is: DATAPLANE_S3__<label>__<orgId>=<jsonConfig>
  where JSON contains: endpoint, bucket, accessKeyId, secretAccessKey.

  Background:
    Given shared S3 configured via S3_ENDPOINT, S3_BUCKET_NAME, etc.
    And a private S3 configured via DATAPLANE_S3__acme__org123

  # ---------------------------------------------------------------------------
  # Env var parsing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Parse private S3 config from env var
    Given env var "DATAPLANE_S3__acme__org123" is set to JSON with endpoint, bucket, accessKeyId, secretAccessKey
    When the private S3 config is loaded at startup
    Then org "org123" maps to the parsed S3 config
    And the label "acme" is ignored by the routing logic

  @unit
  Scenario: Invalid JSON in S3 env var is logged and skipped
    Given env var "DATAPLANE_S3__bad__org999" is set to "not-json"
    When the private S3 config is loaded at startup
    Then org "org999" has no private S3 config
    And a warning is logged

  # ---------------------------------------------------------------------------
  # Organization-level routing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Org with private S3 gets dedicated config
    Given org "org123" has a private S3 configured via env var
    When getS3ConfigForOrganization("org123") is called
    Then the returned config points to the private S3 bucket

  @unit
  Scenario: Org without private S3 gets shared config
    Given org "org456" has no private S3 env var
    When getS3ConfigForOrganization("org456") is called
    Then the returned config points to the shared S3 bucket

  # ---------------------------------------------------------------------------
  # Project-level routing
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Project in a private-S3 org routes to the private bucket
    Given org "org123" has a private S3 configured
    And a project exists under org "org123"
    When S3 config is resolved for this project
    Then the config points to the private S3 bucket
