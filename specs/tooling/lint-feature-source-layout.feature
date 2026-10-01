Feature: The feature-source-layout lint rule
  A strict feature contract artifact names its subject; a process-only
  artifact never lives in contract source; a rules module stays pure
  functions and constants; a process manager is named as a process and sits
  in eventing/, not services/; and every other process source path matches
  one of the strict layout v0 homes.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A contract artifact missing its subject is reported
    Given a contract file named only for its artifact, with no subject
    When the feature-source-layout rule runs over it
    Then it reports contractMissingSubject naming the artifact

  @unit
  Scenario: A process-only artifact in contract source is reported
    Given a contract file named with a process-only artifact suffix
    When the feature-source-layout rule runs over it
    Then it reports contractProcessArtifact
    And the message names the artifact's home under the module's process package

  @unit
  Scenario: A process manager named as a service is reported
    Given a process file whose name ends in -process.service.ts
    When the feature-source-layout rule runs over it
    Then it reports processManagerService
    And the message points at eventing/<subject>.process.ts

  @unit
  Scenario: A rules module constructing a class is reported
    Given a rules module that constructs a class
    When the feature-source-layout rule runs over it
    Then it reports rulesImpurity naming what it found

  @unit
  Scenario: A path with no strict layout home is reported with the allowed homes
    Given a process source path that matches none of the strict layout v0 directories
    When the feature-source-layout rule runs over it
    Then it reports processPath listing the allowed directories

  @unit
  Scenario: A recognized strict process path is left alone
    Given a service file at services/<subject>.service.ts
    When the feature-source-layout rule runs over it
    Then it reports nothing

  @unit
  Scenario: Only the allowed shape has a home
    Given the closed list of process homes the grammar declares
    When a path names one of those homes, or a folder the grammar closed
    Then every named home is accepted and every closed folder is refused
    And the message never names a closed folder
