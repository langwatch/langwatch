Feature: The background worker resolves a plan the way the interactive one does

  Three things this process decides about a customer come from the plan their
  organization is on: whether a webhook batch may leave, how many confirmed
  matches an automation may keep in a day, and how far back a trace's captured
  content stays unteased.

  Both processes install the same entitlement module and ask its EntitlementApi,
  which resolves over the same billing and licensing peers. They must not
  drift: a background process reading the free baseline where the screen reads
  a paid plan stops delivering a feature the customer is being billed for, and
  one reading unlimited where the screen reads free gives away what was sold.

  Background:
    Given a background worker that installs the entitlement module

  @unit
  Scenario: A paying organization resolves onto its own plan in this process
    Given a hosted deployment whose billing peer holds a subscription
    When the plan for a paying organization is resolved
    Then it is the plan their subscription names rather than the free baseline
    And it is the same plan the interactive process resolves
    And an organization holding no subscription still resolves the free baseline

  @unit
  Scenario: A self-hosted deployment resolves the unlimited baseline here too
    Given a deployment that is not the hosted one
    When the plan for any organization is resolved
    Then it is the unlimited baseline, with no visibility window and no member
      ceiling
    And billing is never asked, because a self-hosted plan never comes from a
      subscription

  @unit
  Scenario: A worker without a plan source never boots
    Given a hosted deployment that supplies no billing peer
    When the worker boots
    Then the boot is refused, naming the entitlement module and the billing
      dependency, so a paying organization can never read as free in silence

  @unit
  Scenario: An enterprise organization's webhook entitlement is answered here
    Given an organization on a plan whose tier carries the webhook entitlement
    When their plan is resolved
    Then the entitlement comes back set
    And a plan whose tier does not carry it leaves it unset
    And a plan that withholds it explicitly keeps withholding it

  @unit
  Scenario: A licensed self-hosted deployment resolves the plan its licence names here too
    Given a self-hosted deployment whose organization activated an Enterprise
      licence
    When their plan is resolved in this process
    Then it is the plan the licence names, with the seats the licence sold
    And the message ceiling stays unlimited, because self-hosted volume is never
      metered

  @unit
  Scenario: A licence predating a tier entitlement still carries it here
    Given an Enterprise licence signed before the webhook entitlement existed
    When their plan is resolved in this process
    Then the entitlement comes back set, so a licensed customer's batches leave
      rather than being dropped by the background half while the endpoint page
      says they are enabled

  @unit
  Scenario: A worker composes the licence source over the one client it opened
    Given a background worker that booted its module graph
    When its plan application resolves a tier
    Then it asks the installed licensing peer, the same one every other read
      uses
