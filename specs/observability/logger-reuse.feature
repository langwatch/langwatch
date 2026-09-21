Feature: Loggers are reused without sharing request context
  As an engineer reading production logs
  I want one logger per module name reused for the life of the process
  So that constructing loggers stops costing request time, while every line
  still carries the request it was written for

  Background:
    Building a pino logger is not cheap: it captures a stack trace to resolve
    its caller, and rebuilds a level cache and its bindings. The application
    asks for a logger from more than four hundred places, many of them
    per-instance fields on classes built per request and a few inline inside
    catch blocks, so that construction was measured at 2.3% of the app's wall
    time in production.

    Reuse is only safe because of where the request fields come from. A
    logger's name, service and version are process-wide and fixed when it is
    built. The request fields — trace, span, organization, project and user —
    are supplied per log call from the surrounding request context, not bound
    when the logger is created. Two requests can therefore share one logger
    and still write their own identifiers.

    # Bindings: packages/observability/src/__tests__/loggerReuse.unit.test.ts
    # Sender: packages/observability/src/logger.ts (createLogger)

  @unit
  Scenario: Asking for the same logger twice returns the same logger
    Given a module asks for a logger by name
    When another module asks for a logger by the same name
    Then both are given the same logger rather than a newly built one

  @unit
  Scenario: Different names get different loggers
    Given two modules ask for loggers by different names
    Then each is given its own logger

  @unit
  Scenario: A logger with context disabled never serves a caller that wants context
    Given a module asks for a logger by name with request context disabled
    When another module asks for a logger by that same name with context enabled
    Then they are given different loggers
    # Otherwise whichever call arrived first would decide, silently, whether
    # every later line under that name carried its request fields.

  @unit
  Scenario: Two requests sharing one logger each log their own project
    Given two requests are handled with the same reused logger
    And each request runs under its own project
    When each writes a log line
    Then each line carries the project of the request that wrote it

  @unit
  Scenario: A line written outside a request names no project
    Given no request is in scope
    When a reused logger writes a line
    Then the line carries no project
