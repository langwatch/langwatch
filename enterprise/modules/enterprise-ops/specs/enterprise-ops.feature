Feature: Enterprise operator views
  Operator views over enterprise subjects live in the enterprise ops module, which admits
  Cloud admin staff through OpsApi and forwards to the owner's Api (ARCHITECTURE.md section 3).

  @unit
  Scenario: The enterprise ops module serves the license and self-hosted instance registries
    Given the enterprise ops module is installed
    Then it declares the licenseRegistry and selfHostedInstances namespaces

  @unit
  Scenario: Staff read the self-hosted instance registry from licensing, audited
    Given a Cloud admin staff member
    When they list self-hosted instances
    Then licensing answers and the read is written to the audit log

  @unit
  Scenario: Someone who is not staff is answered with not-found
    Given a signed-in person who is not on the staff list
    When they read a self-hosted instance
    Then the call is refused with not_found and nothing is audited

  @unit
  Scenario: A license registry write needs ops:manage, not ops:view
    Given Cloud admin staff who hold ops:view but not ops:manage
    When they read a registry and then revoke an activation code
    Then the read is answered and the write is refused with permission_denied, unaudited

  @unit
  Scenario: Cloud admin refuses as not found where ops's cloud-ops capability is off
    Given Cloud admin staff where ops's cloud-ops capability is off
    When they read a self-hosted instance
    Then the call is refused with not_found and nothing is audited


  @unit
  Scenario: Core ops serves no operator view over an enterprise subject
    Given the core ops module is installed
    Then it declares neither the licenseRegistry nor the selfHostedInstances namespace
