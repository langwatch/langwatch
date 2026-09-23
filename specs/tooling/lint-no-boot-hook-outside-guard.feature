Feature: The no-boot-hook-outside-guard lint rule
  Process-level failure handling is one seam, not one per package: a second
  `uncaughtException` or `unhandledRejection` listener races the boot guard
  and can swallow the exit it relies on. There are two guards: every `Server`
  installs `installFatalHandlers` (`packages/process-server/src/server.ts`), and
  a one-shot executable boots through `bootNodeExecutable`
  (`packages/observability/src/boot-guard.ts`).

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
  Scenario: A once or addListener handler races the boot guard too
    Given a file outside the boot guard that registers the handlers through process.once and process.addListener
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports bootHookOutsideGuard on each line, naming the method and the event

  @unit
  Scenario: A non boot-failure process event is allowed
    Given a file outside the boot guard that registers an unrelated process event
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports nothing

  @unit
  Scenario: The boot guards own process-level failure handling
    Given packages/process-server/src/server.ts and packages/observability/src/boot-guard.ts each registering an uncaughtException handler
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports nothing

  @unit
  Scenario: A published SDK owns its own process handling
    Given a file under sdks/ registering an uncaughtException handler
    When the no-boot-hook-outside-guard rule runs over it
    Then it reports nothing
