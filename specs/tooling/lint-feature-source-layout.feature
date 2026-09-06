Feature: The feature-source-layout lint rule
  A strict feature contract artifact names its subject; a server-only
  artifact never lives in contract source; a rules module stays pure
  functions and constants; a process manager is named as a process, not a
  service; and every other server source path matches one of the strict
  layout v0 homes.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A contract artifact missing its subject is reported
    Given a contract file named only for its artifact, with no subject
    When the feature-source-layout rule runs over it
    Then it reports contractMissingSubject naming the artifact

  @unit
  Scenario: A server-only artifact in contract source is reported
    Given a contract file named with a server-only artifact suffix
    When the feature-source-layout rule runs over it
    Then it reports contractServerArtifact

  @unit
  Scenario: A process manager named as a service is reported
    Given a server file whose name ends in -process.service.ts
    When the feature-source-layout rule runs over it
    Then it reports processManagerService

  @unit
  Scenario: A rules module constructing a class is reported
    Given a rules module that constructs a class
    When the feature-source-layout rule runs over it
    Then it reports rulesImpurity naming what it found

  @unit
  Scenario: A path with no strict layout home is reported with the allowed homes
    Given a server source path that matches none of the strict layout v0 directories
    When the feature-source-layout rule runs over it
    Then it reports serverPath listing the allowed directories

  @unit
  Scenario: A recognized strict server path is left alone
    Given a service file at services/<subject>.service.ts
    When the feature-source-layout rule runs over it
    Then it reports nothing
