@unit
Feature: Traced services answer with their own shape

  Application services are published to the rest of the system through a
  tracing proxy, so every service call appears in a trace as its own span
  without any method having to say so.

  The proxy stands between a service and everyone who calls it, including the
  service calling itself, because it is also what `this` refers to inside a
  traced method. That makes one property load-bearing: a call through the proxy
  answers with exactly what the method itself answers with. A method that hands
  back a value hands back that value, and only a method that hands back a
  promise is timed until that promise settles.

  Without that property the proxy fails silently rather than loudly: a helper
  that answers with a promise where its caller reads a number makes arithmetic
  NaN, makes a cache key read "[object Promise]" so every tenant collides on one
  entry, and makes every comparison against it false. Nothing throws, and the
  damage surfaces somewhere else entirely.

  Rule: A traced call answers with what the method answers with

    Scenario: A synchronous helper answers with its value
      Given a service published with method tracing
      When a caller reads the result of a synchronous helper
      Then it reads the value itself and not a promise of it
      And the call is still recorded as its own span

    Scenario: A service reading its own helper sees real values
      Given a service published with method tracing
      When one of its methods reaches a synchronous helper through itself
      Then the helper's value is what the method computes with
      And no interpolated key or arithmetic is poisoned by a promise

    Scenario: A method that answers with a promise is timed until it settles
      Given a service published with method tracing
      When a caller invokes a method that answers with a promise
      Then the span stays open until that promise settles
      And this holds whether or not the method was declared asynchronous

  Rule: Failure and streaming keep their shape too

    Scenario: A synchronous helper that fails reaches its caller
      Given a service published with method tracing
      When a synchronous helper throws
      Then the caller catches the failure where it was raised
      And the span is closed and marked as failed

    Scenario: A streaming method stays iterable
      Given a service published with method tracing
      When a caller iterates a streaming method
      Then every item arrives in order
      And one span covers the whole iteration
