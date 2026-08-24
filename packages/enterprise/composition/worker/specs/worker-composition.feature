Feature: Enterprise worker composition

  Scenario: Create the worker composition shell
    When the Enterprise worker composition is created
    Then it exposes the portable catalogue without installing a feature

  Scenario: Import worker composition safely
    When the worker composition package is imported
    Then no queues, jobs, API routes, or web surfaces are registered
