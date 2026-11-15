Feature: Every version of a gateway spend record stays in its request's month
  gateway_spend is partitioned by the month of OccurredAt, and a ReplacingMergeTree replaces one
  version with the next only inside a partition. The fold fixes OccurredAt with the first event it
  folds, so a lookup by request id may prune partitions before FINAL (ADR-202 Decided 24).

  @unit
  Scenario: An outcome folded before its admission is placed at the admission instant it carries
    Given a confirmation that names its admission instant and arrived before its admission
    When the confirmation folds and then the admission folds
    Then both versions carry the admission instant as the request time

  @unit
  Scenario: A late admission never moves a record's request time
    Given an outcome that names no admission instant folded first, in the month after its request
    When the admission folds afterwards
    Then the record keeps the time its first version carried

  @unit
  Scenario: An implausible admission instant never places a record
    Given an outcome folded first whose admission instant is seconds-scale or after the outcome
    When it folds
    Then the record is placed at the outcome's own time

  @unit
  Scenario: A lookup by request id prunes partitions before FINAL
    Given the fold reads one request back, or a request is found across projects
    When the read is built
    Then it carries FINAL and the setting that prunes partitions before FINAL

  @integration
  Scenario: A request folded out of order across a month boundary is found in one partition
    Given a request admitted at the end of a month whose confirmation folded first, in the next month
    When it is looked up by its id alone, with and without the id index
    Then every version of it lies in one partition
    And the bounded read touches fewer parts than the unbounded read
    And both reads return the same row
