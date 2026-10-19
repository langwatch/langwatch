Feature: 1Password is a best-effort source of development secrets
  As a developer keeping credentials in 1Password
  I want the chain to ask 1Password once, then read in parallel, and to step aside when it cannot
  So that a locked vault or a missing op binary never fails a boot that needs nothing from it

  # Alex, 2026-10-09; ARCHITECTURE.md §6. Lookup is unchanged: vault Private,
  # item LangWatch, field = the handle's id, after env and .env.

  @unit
  Scenario: A missing op binary skips 1Password with one warning
    Given an account is set and no op binary is on the path
    When the boot preflights and resolves its secrets
    Then one warning names op as not found
    And optional secrets resolve unset while a required one fails as missing by name

  @unit
  Scenario: A locked 1Password skips the boot's reads with one warning
    Given an account is set and op answers the probe with a non-zero exit
    When the boot preflights and resolves its secrets
    Then one warning names the probe's reason and no field is read
    And optional secrets resolve unset while a required one fails as missing by name

  @unit
  Scenario: An unlocked 1Password answers every needed name in parallel, once
    Given an account is set and op is signed in
    When the boot preflights several handles that env and .env do not answer
    Then op is probed once and the reads overlap
    And each owner's resolve reuses the answer without a second read

  @unit
  Scenario: A field missing from the item is an ordinary miss
    Given an account is set, op is signed in and the item lacks one field
    When the boot preflights and resolves its secrets
    Then the other fields answer, no warning is logged
    And the missing field fails as missing by name only when its handle is required
