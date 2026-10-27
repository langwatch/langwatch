Feature: Periodic work is a scheduled process manager, never a cron route
  As a maintainer
  I want a route under `/api/cron` refused before it lands
  So that periodic work runs on its owner's pipeline, woken by the worker,
  rather than behind a shared bearer an external scheduler must remember to call

  See dev/docs/ARCHITECTURE.md §9: there are no cron routes.

  @unit @architecture
  Scenario: A route declared under /api/cron is refused
    Given a transport declares a route whose path starts with /api/cron
    When the architecture test reads the source
    Then it names the file and the path

  @unit @architecture
  Scenario: A comment or a string that is not a route path is not a route
    Given a source file mentions /api/cron in a comment or an unrelated string
    When the architecture test reads the source
    Then it reports nothing

  @unit @architecture
  Scenario: No tracked source declares a cron route
    Given every tracked TypeScript source outside the tests
    When the architecture test reads them
    Then no route path starts with /api/cron
