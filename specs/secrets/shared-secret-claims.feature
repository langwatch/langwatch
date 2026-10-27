Feature: A shared secret is one exported handle
  As the team composing a process from many owners
  I want a secret two owners legitimately need held as one exported handle
  So that a second meaning for the same credential still refuses at boot

  # ARCHITECTURE.md §6, layer 3 (Alex, 2026-09-25): a double claim passes only
  # when every claimant holds that same handle.

  @unit
  Scenario: Two owners holding the one shared handle both boot
    Given auth and automation both declare the exported session secret handle
    When the boot seam checks every owner's secret claims
    Then the process boots

  @unit
  Scenario: A fresh handle for a shared id still refuses, naming both owners
    Given auth declares the exported session secret handle
    And another owner declares its own handle for NEXTAUTH_SECRET
    When the boot seam checks every owner's secret claims
    Then the boot refuses with secret_claimed_twice naming auth and that owner
