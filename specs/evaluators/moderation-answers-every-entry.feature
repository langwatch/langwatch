Feature: The moderation evaluator answers every entry it was sent
  As someone running a safety check over a dataset,
  I want one verdict per row, scored from that row,
  So that a row is judged on its own text and no row is left without an answer.

  # This evaluator does not call the provider once per entry. It sends the
  # whole batch in two moderation calls, one for the inputs and one for the
  # outputs, and then walks the two result lists together. That shape is a
  # deliberate cost decision, and it makes the walk the only place an entry
  # can be scored: an entry the walk misses gets no answer at all, and the
  # caller has no way to tell which one it lost.

  Rule: One answer per entry, in the order they were sent

    @unit
    Scenario: A batch of several entries gets an answer each
      Given a batch of three entries
      When the moderation evaluator answers it
      Then it returns three results

    @unit
    Scenario: Each entry is scored from its own text
      Given a batch whose first entry is unsafe and whose second is safe
      When the moderation evaluator answers it
      Then the first result fails and the second passes
      And neither result carries the other's score

    @unit
    Scenario: An empty entry is skipped without moving the others
      Given a batch whose middle entry has no input and no output
      When the moderation evaluator answers it
      Then the middle result is skipped
      And the entries either side keep their own scores

  Rule: The batch still costs two provider calls

    @unit
    Scenario: Every entry travels in the same two calls
      Given a batch of two entries with inputs and outputs
      When the moderation evaluator answers it
      Then the provider is called twice
      And the first call carries every input and the second every output
