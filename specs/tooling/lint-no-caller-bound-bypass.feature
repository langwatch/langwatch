Feature: The no-caller-bound-bypass lint rule
  The owner of an operation decides its own limits from where the call came
  from. A contract property such as `isExempt`, `bypassQuota` or
  `skipRateLimit` hands that decision to the caller. The input carries an
  origin instead, and the owner maps the origin to its limit.

  Background:
    Given a workspace whose agent module has a contract and a process half

  @unit
  Scenario: A bypass property on an Api input is reported
    Given a contract interface with properties named isExempt, exemptFromLimits, bypassQuota, skipRateLimit, skipConcurrencyLimit and ignoreLimits
    When the no-caller-bound-bypass rule runs over it
    Then it reports callerBoundBypass on each of them

  @unit
  Scenario: A bypass key in a Zod input shape is reported
    Given a contract z.object shape with a bypassLimit key
    When the no-caller-bound-bypass rule runs over it
    Then it reports callerBoundBypass on the key

  @unit
  Scenario: The report asks for an origin
    Given a contract property named isExempt
    When the no-caller-bound-bypass rule runs over it
    Then the message asks the author to pass the origin of the call

  @unit
  Scenario: An origin and unrelated skip names are accepted
    Given a contract input with an origin, skipCache, skipValidation and limit
    When the no-caller-bound-bypass rule runs over it
    Then it reports nothing

  @unit
  Scenario: Process code and tests are left alone
    Given a process file and a contract test with an isExempt property
    When the no-caller-bound-bypass rule runs over them
    Then it reports nothing
