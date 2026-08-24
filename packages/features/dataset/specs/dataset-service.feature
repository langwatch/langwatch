Feature: Shared Dataset service
  Dataset and Dataset Record behaviour is one process-owned capability.

  Scenario: A dataset is created with a portable contract
    Given the process has one Dataset service
    When a caller creates a dataset for a project with columns and records
    Then the service validates the input with the Dataset contract
    And it returns a portable Dataset value
    And the records are written through the Dataset record repository

  Scenario: Dataset names remain unique within a project
    Given a dataset already exists with the slug "golden-set"
    When a caller validates the name "Golden Set"
    Then the result reports the name as unavailable
    And it identifies the conflicting dataset

  Scenario: A dataset lookup is tenant-scoped
    When a caller looks up a dataset using another project id
    Then the service throws DatasetNotFoundError
    And it does not return the other project's dataset

  Scenario: Records use the Dataset boundary
    When a caller creates, updates, lists, or deletes records
    Then the service checks that the Dataset is ready
    And it delegates persistence to the Dataset record repository
    And it does not expose Prisma records

  Scenario: Dataset copy remains a Dataset operation
    When a caller copies a dataset to another project
    Then the service creates the target through its own repository
    And it copies records through the Dataset record repository
    And it does not construct a Dataset Record feature

  Scenario: Compatibility transports share one service
    When the tRPC or REST Dataset transport handles a request
    Then it reads the process-owned Dataset service
    And it does not construct a service or repository per request

  Scenario: Upload storage remains an injected Dataset seam
    When an upload is normalized or S3 JSONL chunks are rewritten
    Then the Dataset service uses injected storage and queue capabilities
    And it does not import an object-store client or global Prisma
