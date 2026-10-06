Feature: Private Dataplane S3 Routing

  Enterprise customers can have a dedicated S3 bucket for data isolation.
  This covers all app-managed storage: datasets, images, audio, and any
  user-uploaded content (NOT ClickHouse's internal S3 for cold storage).

  Credentials come from environment variables as a JSON config. The env var
  format is: DATAPLANE_S3__<label>__<orgId>=<jsonConfig>
  where JSON contains: endpoint, bucket, accessKeyId, secretAccessKey.

  Background:
    Given shared object storage configured via STORED_OBJECTS_BACKEND, S3_BUCKET_NAME, etc.
    And a private S3 configured via DATAPLANE_S3__acme__org123

  # ---------------------------------------------------------------------------
  # Env var parsing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Parse private S3 config from env var
    Given env var "DATAPLANE_S3__acme__org123" is set to JSON with endpoint, bucket, accessKeyId, secretAccessKey
    When the stores parse the DATAPLANE_S3__ family at boot
    Then org "org123" maps to an S3 account with that endpoint, bucket and credentials
    And the label "acme" is ignored by the routing logic

  @unit
  Scenario: Invalid JSON in S3 env var is logged and skipped
    Given env var "DATAPLANE_S3__bad__org999" is set to "not-json"
    When the stores parse the DATAPLANE_S3__ family at boot
    Then org "org999" has no private S3 config
    And a warning naming the env var is logged

  @unit
  Scenario: S3 env var missing a field is logged and skipped
    Given env var "DATAPLANE_S3__partial__org888" is set to JSON without accessKeyId and secretAccessKey
    When the stores parse the DATAPLANE_S3__ family at boot
    Then org "org888" has no private S3 config
    And a warning naming the env var is logged

  @unit
  Scenario: Two S3 env vars for one organisation refuse boot
    Given env vars "DATAPLANE_S3__one__org123" and "DATAPLANE_S3__two__org123" are both set to valid JSON
    When the stores parse the DATAPLANE_S3__ family at boot
    Then boot is refused naming organisation "org123"

  # ---------------------------------------------------------------------------
  # Organization-level routing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Org with private S3 gets dedicated config
    Given org "org123" has a private S3 configured via env var
    When object storage places a project of org "org123"
    Then the project's destination is the private S3 bucket

  @unit
  Scenario: Org without private S3 gets shared config
    Given org "org456" has no private S3 env var
    When object storage places a project of org "org456"
    Then the project's destination is the shared S3 bucket

  # ---------------------------------------------------------------------------
  # Project-level routing
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Project in a private-S3 org routes to the private bucket
    Given org "org123" has a private S3 configured
    And the shared backend is Azure Blob
    And a project exists under org "org123"
    When the stores open and the project writes and reads an object
    Then the object lives in the private S3 bucket, never the shared Azure container
