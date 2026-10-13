Feature: A procedure dispatched by path shares the cache a typed hook reads
  Most screens call a procedure through their module's derived tRPC hook. A
  surface that covers many procedures behind one path string cannot, so the
  shell composes `UiRpc` for it: call a procedure by name, and the answer lands
  under the same cache key the typed hook would have written, so the two never
  hold two versions of one read.

  Background:
    Given a browser application whose shell composed the by-path dispatcher

  @unit
  Scenario: A dispatched procedure lands under the typed hook's key
    Given a procedure dispatched by name
    When it has been read
    Then it is published under the key a typed hook would read
    And a tRPC invalidation naming that procedure invalidates it

  # The chrome, the organization facts and the `?org` reader all do the same
  # thing: a useQuery on a tRPC key whose queryFn dispatches that same
  # procedure by path. Joining the fetch already in flight for that key means
  # joining the observer's OWN fetch — so the queryFn awaits the promise it is
  # itself supposed to resolve, and the query stays pending for the life of the
  # document. It reports 200 on the network and never settles in the cache, so
  # the chrome waits on a workspace graph that already arrived, and every
  # address behind the chrome renders a spinner and nothing else.
  @integration
  Scenario: A query that dispatches its own key still settles
    Given a page whose query dispatches its own key through the dispatcher
    When the page renders
    Then the query settles with the answer
    And the page draws rather than waiting forever
