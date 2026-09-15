Feature: The no-boot-hook-outside-guard lint rule
  Process-level failure handling is one seam, not one per package: a second
  `uncaughtException` or `unhandledRejection` listener races the boot guard
  and can swallow the exit it relies on.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A second uncaughtException handler races the boot guard
    Given a file outside the boot guard that registers an uncaughtException handler
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports bootHookOutsideGuard
    And the message names the process event

  @unit
  Scenario: A second unhandledRejection handler races the boot guard
    Given a file outside the boot guard that registers an unhandledRejection handler
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports bootHookOutsideGuard

  @unit
  Scenario: A non boot-failure process event is allowed
    Given a file outside the boot guard that registers an unrelated process event
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports nothing

  @unit
  Scenario: The boot guard owns process-level failure handling
    Given the boot guard file itself registering an uncaughtException handler
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports nothing
