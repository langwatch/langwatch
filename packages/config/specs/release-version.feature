Feature: The release this install runs is one pair of shared leaves
  As the team composing a process from the framework and many modules
  I want SERVICE_VERSION and OTEL_RESOURCE_ATTRIBUTES declared once, as leaves in @langwatch/config
  So that observability and every module that reports a version read them without a collision

  # ARCHITECTURE.md §6, layer 3: the parse admits a re-bound env var only when
  # the claimants are literally the same leaf.

  @unit
  Scenario: Observability and a module both holding the release leaves parse them
    Given the observability owner and a module both hold the exported release leaves
    When the process parses its config with SERVICE_VERSION and OTEL_RESOURCE_ATTRIBUTES set
    Then each owner's slice carries the same values

  @unit
  Scenario: The release version is the one the deployment named
    Given an owner holds the exported release leaves
    When SERVICE_VERSION is set, or only OTEL_RESOURCE_ATTRIBUTES names a service.version
    Then the release version is SERVICE_VERSION first, then the percent-decoded service.version

  @unit
  Scenario: A deployment that names no release reports unknown
    Given an owner holds the exported release leaves
    When neither SERVICE_VERSION nor a service.version attribute is named, or either is blank
    Then the release version is "unknown", never a number made up here
