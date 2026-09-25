Feature: Enterprise operator views
  Operator views over enterprise subjects live in the enterprise ops module, which admits
  back-office staff through OpsApi and forwards to the owner's Api (ARCHITECTURE.md section 3).

  @unit
  Scenario: The enterprise ops module serves the license and self-hosted instance registries
    Given the enterprise ops module is installed
    Then it declares the licenseRegistry and selfHostedInstances namespaces

  @unit
  Scenario: Staff read the self-hosted instance registry from licensing, audited
    Given a back-office staff member
    When they list self-hosted instances
    Then licensing answers and the read is written to the audit log

  @unit
  Scenario: Someone who is not staff is answered with the back office's not-found
    Given a signed-in person who is not on the staff list
    When they read a self-hosted instance
    Then the call is refused with not_found and nothing is audited

  @unit
  Scenario: Core ops serves no operator view over an enterprise subject
    Given the core ops module is installed
    Then it declares neither the licenseRegistry nor the selfHostedInstances namespace
