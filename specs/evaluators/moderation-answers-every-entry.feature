Feature: The moderation evaluator answers every entry it was sent
  As someone running a safety check over a dataset,
  I want one verdict per row, scored from that row,
  So that a row is judged on its own text and no row is left without an answer.

  # An entry left without an answer is invisible to the caller. The results
  # come back as a list, so a batch that answers fewer entries than it was
  # sent gives no way to tell which rows were never judged. A safety check
  # that reports rows as clean because a different row was is the wrong way
  # for this evaluator to be wrong.

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

    @unit
    Scenario: A short answer from the provider still leaves one result per entry
      Given a batch of several entries
      When the provider answers fewer entries than were sent
      Then every entry still has a result
      And the entries the provider did not cover are reported as errors

    @unit
    Scenario: An empty batch is answered without calling the provider
      Given a batch with no entries
      When it is evaluated
      Then the answer is empty
      And no provider call is made

  Rule: The batch still costs two provider calls

    @unit
    Scenario: Every entry travels in the same two calls
      Given a batch of two entries with inputs and outputs
      When the moderation evaluator answers it
      Then the provider is called twice
      And the first call carries every input and the second every output
