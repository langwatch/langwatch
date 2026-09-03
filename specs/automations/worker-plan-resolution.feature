Feature: The background worker resolves a plan the way the interactive one does

  Three things this process decides about a customer come from the plan their
  organization is on: whether a webhook batch may leave, how many confirmed
  matches an automation may keep in a day, and how far back a trace's captured
  content stays unteased. All three used to be refused or assumed here, because
  no plan source was composed.

  Both processes now resolve from the deployment's own subscription rows over
  the same baseline, and they must not drift: a background process reading the
  free baseline where the screen reads a paid plan stops delivering a feature
  the customer is being billed for, and one reading unlimited where the screen
  reads free gives away what was sold. The scenarios below are deliberately the
  ones the interactive process's own suite asserts.

  Background:
    Given a background worker that opened its own database client

  @unit
  Scenario: A paying organization resolves onto its own plan in this process
    Given a hosted deployment holding the subscription rows
    When the plan for a paying organization is resolved
    Then it is the plan their subscription names rather than the free baseline
    And an organization holding no subscription still resolves the free baseline
    And no missing subscription source is reported

  @unit
  Scenario: A self-hosted deployment resolves the unlimited baseline here too
    Given a deployment that is not the hosted one
    When the plan for any organization is resolved
    Then it is the unlimited baseline, with no visibility window and no member
      ceiling
    And it stays the unlimited baseline even where a subscription row exists
    And no missing subscription source is reported, because a self-hosted plan
      never comes from one

  @unit
  Scenario: A process that cannot read a plan says which source it is missing
    Given a hosted deployment holding no subscription rows
    When the plan provider is composed
    Then it reports the missing subscription source by name, so a paying
      organization reading as free is visible at boot

  @unit
  Scenario: An enterprise organization's webhook entitlement is answered here
    Given an organization on a plan whose tier carries the webhook entitlement
    When their plan is resolved
    Then the entitlement is applied from the tier rather than from the contract
    And a plan whose tier does not carry it leaves it unset
