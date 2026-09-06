Feature: The api-context-services lint rule
  A strict feature API class delegates through `context.app`; it does not
  construct services, repositories, stores or adapters, does not cast the
  context to recover one, does not call its own static options as a
  per-request resolver, and does not double-await a resolved call.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: Constructing a service inside an API class is reported by name
    Given an API class method that constructs a Service directly
    When the api-context-services rule runs over it
    Then it reports construction naming the constructed class
    And the message tells the reader to take it from context.app

  @unit
  Scenario: A double-await in an API class is reported
    Given an API class method that awaits an already-awaited call
    When the api-context-services rule runs over it
    Then it reports doubleAwait

  @unit
  Scenario: Calling this.options as a resolver is reported
    Given an API class method that calls this.options as a per-request resolver
    When the api-context-services rule runs over it
    Then it reports resolver

  @unit
  Scenario: Casting the API context is reported
    Given an API class method that casts its context parameter
    When the api-context-services rule runs over it
    Then it reports contextCast
