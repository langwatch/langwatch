# See dev/docs/adr/172-oversized-payloads-live-under-expirable-prefixes.md
Feature: One confirmation that the object store reaps every oversized-payload prefix
  As an operator who runs object storage the application cannot inspect
  I want to state once that every lifecycle rule exists
  So that Azure accepts oversized writes only when the rules are in place

  Background:
    Given the lifecycle table lists every prefix an oversized payload is written under
    And the application holds a data-plane key and cannot read the container's lifecycle policy

  @unit @configuration
  Scenario: Neither variable set leaves the retention unconfirmed
    Given neither OBJECT_RETENTION_CONFIRMED nor AZURE_BLOB_SPOOL_RETENTION_CONFIRMED is set
    When the stored-object configuration is read
    Then objectRetentionConfirmed is false

  @unit @configuration
  Scenario: The object retention variable confirms every prefix
    Given OBJECT_RETENTION_CONFIRMED is "true" or "1"
    When the stored-object configuration is read
    Then objectRetentionConfirmed is true

  @unit @configuration
  Scenario: The earlier Azure spool variable still confirms
    Given only AZURE_BLOB_SPOOL_RETENTION_CONFIRMED is "true"
    When the stored-object configuration is read
    Then objectRetentionConfirmed is true

  @unit @configuration
  Scenario: An explicit refusal on the new variable wins over the earlier one
    Given OBJECT_RETENTION_CONFIRMED is "false"
    And AZURE_BLOB_SPOOL_RETENTION_CONFIRMED is "true"
    When the stored-object configuration is read
    Then objectRetentionConfirmed is false

  @unit @configuration
  Scenario: Any value other than 1 or true does not confirm
    Given OBJECT_RETENTION_CONFIRMED is "yes"
    When the stored-object configuration is read
    Then objectRetentionConfirmed is false
