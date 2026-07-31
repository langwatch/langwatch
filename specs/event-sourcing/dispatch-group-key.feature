@unit
Feature: A group key states what is ordered and what may be batched
  Work is queued into lanes, and lanes run independently of each other. So the
  key that picks a lane decides two things at once: what is processed in order
  relative to what, and what may be gathered into a single write. They are one
  property seen from two sides — a lane is both the unit of ordering and the
  unit of batching.

  Because that choice is consequential, it is declared rather than assembled. A
  key names a tenant, a lane, and a scope; the scope says how wide the lane is.
  A key built by joining strings together hides the choice inside punctuation,
  and the two ways that goes wrong are not symmetrical: a lane that is too wide
  removes parallelism, and a lane that is too narrow removes the batching a
  pre-aggregated table exists to get. (ADR-100.)

  Background:
    Given work is queued under a key naming a tenant, a lane and a scope

  @unimplemented
  Scenario: a lane scoped to one aggregate processes that aggregate in order
    Given a projection that reads its prior state before writing
    When two pieces of work arrive for the same aggregate
    Then they are placed in the same lane
    And the second is not started until the first has finished

  @unimplemented
  Scenario: a lane scoped to one event runs every event at once
    Given a projection that derives each row from a single event alone
    When many events arrive
    Then each is placed in a lane of its own
    And they are processed concurrently

  Scenario: a lane scoped to one event can never gather a batch
    Given a projection whose lane holds exactly one event
    When the projection asks to write several rows in one go
    Then the request is refused when the projection is registered
    And the refusal names the scope as the reason

  @unimplemented
  Scenario: a lane scoped to a declared partition is the unit of batching
    Given a projection that groups its work by a stated set of dimensions
    When events arriving for one combination of those dimensions are queued
    Then they share a lane
    And they may be written together

  Scenario: two tenants never share a lane
    Given a projection whose lane is declared to cover everything it sees
    When work arrives for two different tenants
    Then the two tenants are still placed in separate lanes

  Scenario: a value containing punctuation cannot merge two lanes
    Given one projection groups its work by a single dimension whose value
      contains the character used to separate parts of a key
    And another groups its work by two dimensions whose values are the pieces
      either side of that character
    When both are queued
    Then they are placed in different lanes

  Scenario: a key can be read back to say which tenant, lane and scope it names
    Given work has been queued under any key the platform produces
    When an operator inspects the queue
    Then the tenant, the lane and the scope can be recovered from the key
    And no pattern matching on the key's text is required

  Scenario: a key that did not come from the platform is rejected
    Given a key that names a lane the platform does not have
    When it is read back
    Then reading it fails
    And the failure names what about the key was not understood

  Scenario: every key belonging to one lane is stored together
    Given the queue is running against a clustered cache
    When work is queued under any key the platform produces
    Then every stored value for that lane resolves to a single cache partition
    And a value inside the key cannot split that grouping
