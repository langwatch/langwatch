Feature: Object storage provider parity and migration
  As a self-hosted LangWatch operator
  I want Azure Blob to work as a complete storage option and a controlled way to change providers
  So that I can choose S3 or Azure without making customer data unavailable

  @integration
  Scenario: An Azure-only installation supports every shared object-storage workload
    Given Azure Blob is the selected provider
    And no S3 bucket is configured
    When the installation stores and reads stored objects, dataset chunks, and durable queue payloads
    Then every workload round-trips successfully through Azure Blob

  @unit
  Scenario: The legacy S3 selector keeps its existing fallback behavior
    Given the stored-objects backend is set to S3
    And no global or private S3 bucket is configured
    When the write destination is resolved
    Then the existing local-filesystem fallback is selected

  @integration
  Scenario Outline: An invalid inactive Azure configuration does not block S3 traffic
    Given S3 is the active write destination
    And incomplete Azure settings remain in the deployment
    When a <project type> project stores and reads an object
    Then the object round-trips without an inactive-Azure configuration error

    Examples:
      | project type   |
      | global-S3      |
      | private-bucket |

  @integration
  Scenario: Helm selects S3 and Azure symmetrically without breaking legacy S3 configuration
    Given the chart supports the awsS3 and azureBlob dataplane providers
    When the operator renders each provider configuration
    Then each render explicitly selects its intended provider
    And an existing S3 installation retains its documented bucket environment contract

  @integration
  Scenario: A migration dry run changes no customer data
    Given source and destination credentials are valid
    And durable data exists on the source provider
    When the operator runs the migration plan
    Then the report identifies the data eligible for migration
    And no bytes or storage addresses are changed

  @integration
  Scenario: Global provider migration excludes private S3 projects
    Given a project uses a private S3 bucket
    When the operator plans a global provider migration
    Then the project is reported as excluded
    And none of its bytes or storage addresses are changed

  @integration
  Scenario: Online copy keeps live reads on the source provider
    Given customer traffic is still running against the source provider
    When the operator runs the online copy phase
    Then verified copies are written to the destination
    And live reads continue using the source storage addresses
    And no destination storage address is published before finalization
    And source bytes remain unchanged

  @integration
  Scenario: An interrupted online copy resumes safely
    Given a previous copy stopped after migrating only part of the eligible data
    And one destination object is present with bytes that do not match its source
    When the operator runs the copy phase again
    Then already verified destination objects are not recopied
    And missing or mismatched objects are copied and verified

  @integration
  Scenario: Active dataset uploads block finalization
    Given a dataset is uploading or processing
    When the operator attempts to finalize the provider migration
    Then finalization is refused with the blocking datasets identified
    And the active provider remains unchanged

  @integration
  Scenario: A dataset with no usable chunk count is reported rather than aborting the run
    Given an abandoned upload left a dataset with no chunk count
    When the operator runs the migration plan
    Then the dataset is reported as a blocker with its reason
    And the copy phase still migrates the remaining eligible data
    And finalization is refused while the dataset remains

  @integration
  Scenario Outline: Outstanding queue work blocks finalization
    Given the migration audit finds <blocking condition>
    When the operator attempts to finalize the provider migration
    Then finalization is refused with the blocking queues identified
    And the active provider remains unchanged

    Examples:
      | blocking condition                    |
      | a pending job                         |
      | a delayed job                         |
      | an active job                         |
      | a blocked job                         |
      | a staged durable-storage reference    |

  @unit
  Scenario: Provider migration does not change the durable queue reference format
    Given a durable queue reference written before provider migration
    When the deployment is upgraded with provider-migration support
    Then the reference keeps its existing fields and version
    And existing workers can still decode it

  @integration
  Scenario: Finalization publishes verified destination addresses without erasing history
    Given writes are paused
    And a stored object has verified source and destination bytes
    When the operator finalizes that stored object
    Then its newest address points to the verified destination bytes
    And its earlier source-address history remains recoverable

  # Locked migration decision: datasets do not gain per-dataset provider
  # provenance. Every non-BYOC dataset chunk must verify at the destination
  # before the global provider switch.
  @integration
  Scenario Outline: A finalized provider migration preserves durable customer data
    Given all writes are paused
    And all eligible stored objects and dataset chunks have verified destination copies
    And no dataset upload or durable queue reference blocks cutover
    When the operator finalizes the migration from <source> to <destination>
    Then stored objects and datasets remain readable from <destination>
    And new writes use <destination>

    Examples:
      | source     | destination |
      | S3         | Azure Blob  |
      | Azure Blob | S3          |

  @integration
  Scenario: A failed finalization can be resumed before traffic restarts
    Given writes remain paused
    And finalization stopped after changing only part of the storage addresses
    When the operator runs finalization again
    Then it completes the remaining verified address changes
    And no address points to an unverified destination object

  @integration
  Scenario: Successful migration does not delete source data
    Given a provider migration has finalized successfully
    When the operator verifies the destination and resumes traffic
    Then the source bytes remain available for an explicit rollback
