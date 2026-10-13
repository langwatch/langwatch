Feature: Dataset normalization writes to the deployment's configured Azure account
  As a self-hosted operator with STORED_OBJECTS_BACKEND=azure
  I want an uploaded dataset's chunks to land in the same Azure Blob account
  as every other stored object
  So that my dataset does not silently fail to finish processing, or land on
  a local disk the next pod cannot read

  # The worker process resolves one storage backend per project the same way
  # the rest of the deployment's object storage does: S3, Azure or the local
  # filesystem, chosen by the shared destination policy. An Azure-routed
  # project must not fall back to the single-replica local disk, and must not
  # be refused outright now that the process composes the same Azure Blob
  # driver credentials the general object-storage path uses.

  @unit
  Scenario: An Azure-routed project's dataset chunks resolve to the Azure adapter
    Given a worker composed with STORED_OBJECTS_BACKEND=azure and a valid Azure Blob account
    When dataset normalization resolves storage for a project routed to Azure
    Then it returns the Azure dataset storage adapter, not a refusal and not the local filesystem
