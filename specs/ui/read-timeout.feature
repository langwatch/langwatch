Feature: A read the API never answers gives up and is tried again

  A request the network swallows (a proxy holding the connection, a link that
  drops packets) never fails on its own. Without a time limit the page waits on
  it forever and the retry policy never gets its turn. The limit sits above the
  API's own limit on a read, so it never cuts off an answer the server would
  still give.

  @unit
  Scenario: A read with no answer gives up after 45 seconds
    Given a read the API does not answer
    When 45 seconds pass
    Then the read fails as timed out
    And the retry policy can send it again

  @unit
  Scenario: A read the page cancels is cancelled at once
    Given a read in flight
    When the page cancels it
    Then the read fails as cancelled, not as timed out

  @unit
  Scenario: A write is never given a time limit
    Given a write the API has not answered yet
    When 45 seconds pass
    Then the write is still waiting, since the server may still apply it
