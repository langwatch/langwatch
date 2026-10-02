Feature: Nurturing sends the signals its owners record
  Each owner tells nurturing through a subscriber on its own pipeline, with ids
  plus what the owner's event holds. The signal lands as an event on nurturing's
  pipeline, and nurturing's subscriber sends Customer.io and PostHog what main
  sent. Nurturing names no peer and fetches nothing.

  @unit
  Scenario: An owner's signal lands on nurturing's pipeline keyed by its source event
    Given an owner records a signal for one of its events
    When the same signal is recorded again for that event
    Then both land under the same aggregate and idempotency key

  @unit
  Scenario: A created scenario reaches PostHog and Customer.io with main's attributes
    Given a person created a scenario in a project
    When its signal is delivered
    Then PostHog receives scenario_created with the project
    And Customer.io is told the project's scenario count and receives scenario_created

  @unit
  Scenario: A first trace reaches PostHog and Customer.io, against the organization's admin
    Given a project's first trace named its SDK
    When its signal is delivered
    Then PostHog receives first_trace_integrated with the SDK language, framework and project
    And Customer.io is told has_traces, the SDK and the first trace's time, and receives first_trace_integrated

  @unit
  Scenario: A scenario in an onboarding experiment carries its variant to PostHog
    Given a person created a scenario in an organization the onboarding experiment assigned a variant
    When its signal is delivered
    Then PostHog's scenario_created carries onboarding_variant and the experiment property

  @unit
  Scenario: A connected agent's successful scenario run reaches PostHog against the admin
    Given a scenario run against a connected agent finished with a verdict
    When its signal is delivered
    Then PostHog receives scenario_run_succeeded with the scenario, the run, connected_agent and the experiment property
    And Customer.io receives nothing

  @unit
  Scenario: A created workflow tells Customer.io the project's workflow count
    Given a person created a workflow in a project
    When its signal is delivered
    Then Customer.io is told the workflow count and receives workflow_created with the workflow and project

  @unit
  Scenario: A completed checkout marks the organization's PostHog group as subscribed
    Given an organization completed a checkout
    When its signal is delivered
    Then PostHog receives subscription_created against the organization
    And the organization's group properties say it has an active subscription since the checkout

  @unit
  Scenario: A redelivered signal is sent once
    Given a signal was delivered
    When the same signal is delivered again
    Then its sinks received it once

  @unit
  Scenario: Trace, simulation and evaluation updates to Customer.io are debounced per tenant
    Given a trace update signal for a tenant was just delivered to Customer.io
    When a second trace update signal for the same tenant is delivered within five minutes
    Then Customer.io receives the update once

  @unit
  Scenario: With no sink configured a signal is recorded and nothing is sent
    Given the deployment named neither a Customer.io key nor a PostHog key
    When a signal is delivered
    Then nothing is claimed and nothing is sent

  @unit
  Scenario: A Customer.io outage is logged and the delivery completes
    Given Customer.io answers every call with a server error
    When a created scenario's signal is delivered
    Then the delivery completes and the failure is reported

  # Dropped (Alex, "ids only"/payload ruling, 2026-09-29): nurturing now reads the email and
  # name from UserApi at signed_up delivery, so it is no longer peerless. Faking every peer
  # UserApi itself needs is disproportionate to an isolated boot check; the api and worker
  # installation tests (apps/api, apps/worker) already boot nurturing for real, with UserApi
  # provided, and assert it records a signal.

  # Evaluation milestones (Alex, 2026-09-30, option D1a): nurturing names the admin and counts
  # evaluations from its own store, fed by project's created event and evaluation's completion
  # fact. Accepted wire difference: evaluation_count restarts from zero at the cutover.
  @unit
  Scenario: The evaluation milestone names the admin from project's created event
    Given project's created event named the organization's admin
    When an evaluation in that project settles
    Then Customer.io is told about it against that admin, with nurturing's own count of the organization's evaluations

  @unit
  Scenario: A seeded organization's first counted evaluation is not its first milestone
    Given nurturing learned an organization from project's backfill
    When the first evaluation nurturing counts for it settles
    Then no first_evaluation_created is sent and the traits carry the count since the cutover

  @unit
  Scenario: Project's backfill is idempotent for nurturing
    Given nurturing learned an organization from a live project creation
    When project's backfill records that project again, once or many times
    Then the organization stays unseeded and its first evaluation still raises the milestone
