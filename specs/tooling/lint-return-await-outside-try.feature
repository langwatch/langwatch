Feature: The return-await-outside-try lint rule
  `return await x` outside a try changes nothing the caller can observe: the
  function already returns a promise, and nothing there can catch a rejection
  and rewrap it, so the await only adds a microtask tick. Inside a try, the
  await is load-bearing — it is what lets that try's own catch/finally
  observe the rejection before the function returns. A `using`/`await using`
  declaration in scope, and an async generator's return, are both sites where
  the await is doing real work, so those sites are never reported at all. The
  rule fixes every site it reports by deleting the await.

  @unit
  Scenario: A ritual return await outside any try is reported and the await is deleted
    Given a governed source file whose async function returns an awaited call with no enclosing try
    When the return-await-outside-try rule runs over it
    Then it reports ritualReturnAwait
    And fixing deletes the await, returning the expression directly

  @unit
  Scenario: The fixed file reports nothing
    Given a governed source file whose async function already returns the expression directly
    When the return-await-outside-try rule runs over it
    Then it reports nothing

  @unit
  Scenario: A return await inside a try is left alone
    Given a governed source file whose return await sits inside a try block, its catch handler, or its finally block
    When the return-await-outside-try rule runs over it
    Then it reports nothing

  @unit
  Scenario: A return await in a function with a using declaration is left alone
    Given a governed source file whose enclosing function opens a using or await using resource
    When the return-await-outside-try rule runs over it
    Then it reports nothing

  @unit
  Scenario: A return await in an async generator is left alone
    Given a governed source file whose async generator function returns an awaited expression
    When the return-await-outside-try rule runs over it
    Then it reports nothing

  @unit
  Scenario: An outer try does not protect an inner function's return await
    Given a governed source file whose inner function's return await is not itself inside a try, even though an outer function's try surrounds the inner function's declaration
    When the return-await-outside-try rule runs over it
    Then it reports ritualReturnAwait
