Feature: Asking when a project's newest trace occurred, leaving some conversations out

  A daily check asks whether a project has new traces since a time before it reads
  anything else. Its own work is traced into the project in conversations it opened, so
  it names those conversations to leave out. A trace with no conversation is never left
  out by that list.

  @integration
  Scenario: A recency read leaving conversations out still finds the other traces
    Given a project with three traces since the bound: one with no conversation, one in conversation A and one in conversation B
    And the trace in conversation A is the newest
    When the newest trace is asked for, leaving conversation A out
    Then the answer is the newer of the other two traces
    And leaving both conversations out still finds the trace with no conversation

  @unit
  Scenario: A recency read binds the left-out conversations as a parameter
    Given a trace recency read that leaves conversations out
    Then the read keeps a trace with no conversation and leaves out the named conversations, bound as a parameter
    And an empty list adds no clause and no parameter
    And an evaluation read ignores the list
