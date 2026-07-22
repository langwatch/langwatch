Feature: Versioned automations customer API

  Customers and their agents manage automation rules through a versioned,
  RPC-shaped API: every operation is a verb-named call with exactly one
  input and one output contract, so an agent binds tools to operations
  one-to-one. The three rule kinds (on-trace automation, alert, scheduled
  report) share one rule shape discriminated by kind. Reads can never
  return secret material, and every failure is a typed handled error with
  remediation the caller can act on.

  See dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md.

  Background:
    Given a project with a valid API key

  Rule: Operations are versioned and self-describing

    Scenario: Calling a pinned version keeps working after newer versions ship
      Given a rule was created through a dated API version
      When a newer API version is released
      Then calls pinned to the original version behave as they did before

    Scenario: The API documents every operation
      When the caller fetches the API's reference document
      Then every operation appears with its input contract, output contract, and error envelope
      And each operation is named after the action it performs

  Rule: One rule shape covers the three kinds

    Scenario: Creating an alert rule
      When the caller creates a rule of kind alert watching a metric with a threshold and severity
      Then the rule is created and listed with its kind

    Scenario: Creating a scheduled report rule
      When the caller creates a rule of kind report with a calendar schedule, timezone, and content source
      Then the rule is created and its next run time is available

    Scenario: Creating an on-trace rule that collects into a dataset
      When the caller creates a rule of kind automation with trace conditions and a dataset destination
      Then the rule is created and matching traces are added to the dataset

    Scenario: Facets from the wrong kind are rejected
      When the caller creates a rule of kind report carrying an alert threshold
      Then the call fails as a validation error naming the offending field

  Rule: Delivery covers every channel

    Scenario Outline: A rule can deliver to any supported channel
      When the caller creates a rule delivering to <channel>
      Then the rule is created and fires deliver to <channel>

      Examples:
        | channel                |
        | a Slack channel        |
        | an HTTP webhook        |
        | email recipients       |
        | a dataset              |
        | an annotation queue    |

  Rule: Secrets are write-only

    Scenario: Reading a rule masks its delivery secrets
      Given a rule delivering to a Slack incoming webhook
      When the caller reads the rule
      Then the webhook address is masked
      And no operation returns the stored secret in full

    Scenario: Updating a rule without resending a secret keeps it
      Given a rule with a stored webhook secret
      When the caller updates the rule's name without providing the secret
      Then the stored secret is unchanged and deliveries keep working

  Rule: Failures are handled errors with remediation

    Scenario: Operating on a rule that does not exist
      When the caller reads a rule id that does not exist in the project
      Then the call fails with a stable not-found code

    Scenario: A rule from another project is not reachable
      Given a rule that belongs to a different project
      When the caller reads that rule id
      Then the call fails with the same not-found code as a missing rule

    Scenario: Customer-actionable failures explain themselves
      When a call fails for a reason the caller can fix
      Then the error carries a stable code, remediation tips, and a documentation link

  Rule: Runtime state is queryable

    Scenario: Checking a rule's health
      Given an alert rule that is currently firing
      When the caller asks for the rule's status
      Then the status reports it as firing with when it last fired

    Scenario: Listing a rule's fire history
      Given a rule that has fired
      When the caller lists the rule's fires
      Then each fire shows when it fired and where it delivered

    Scenario: A test fire is unmistakably a test
      When the caller test-fires a rule
      Then a delivery arrives at the configured destination marked as a test

  Rule: The legacy triggers API is deprecated

    Scenario: Legacy calls are told to migrate
      When a caller uses the legacy triggers API
      Then the response signals deprecation and points at the replacement

    Scenario: The legacy API is removed after the migration window
      Given the migration window has passed
      When a caller uses the legacy triggers API
      Then the call fails as gone
