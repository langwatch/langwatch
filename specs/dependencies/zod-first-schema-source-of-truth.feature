Feature: Zod schemas are the single source of truth for shared types

  Shared data shapes (traces, spans, evaluations, evaluators, datasets and
  experiments) are defined once as Zod schemas. Their TypeScript types are
  inferred from those schemas with z.infer. There is no compile-time code
  generation step that derives Zod schemas from TypeScript types, so the
  server, workers and SDK start without running ts-to-zod.

  Background:
    Given the platform shares data shapes between the app, workers and the SDK

  @unit
  Scenario: Starting the server does not run a type-to-schema generator
    Given a developer runs the dev or build preparation step
    When the prepare step finishes
    Then no ts-to-zod generation runs
    And no "File not found" or "fallback into z.any()" generation warnings are printed
    And no *.zod.generated or types.generated file is produced for tracer, datasets or experiments

  Scenario: A type and its schema never disagree
    Given a shared shape is defined as a Zod schema
    When a developer references its TypeScript type
    Then the type is inferred from the schema
    And changing the schema changes the type with no separate type definition to keep in sync

  @unit
  Scenario: The collector validates an incoming trace against the span schema
    Given a client posts spans to the collector endpoint
    When the collector parses the request body
    Then a well-formed span is accepted unchanged
    And a span missing required fields is rejected with a validation error

  @unit
  Scenario: Evaluator settings are validated against schemas built from the evaluator catalog
    Given an evaluator exposes a set of settings with defaults
    When a user saves an evaluator with only some settings provided
    Then the missing settings fall back to their documented defaults
    And settings with an invalid value are rejected

  @unit
  Scenario: The evaluator catalog still lists every available evaluator
    Given the evaluator catalog is generated from the evaluation service
    When the app reads the catalog
    Then every evaluator name, category, required fields and default settings are present
    And the catalog content matches what was shipped before the source-of-truth change

  Scenario: The SDK ships the same shared schemas without a generation step
    Given the TypeScript SDK consumes the shared trace and evaluator shapes
    When the SDK is built
    Then it reuses the Zod schemas copied from the platform
    And it validates chat messages and span input/output against those schemas
    And no ts-to-zod step runs during the SDK build
