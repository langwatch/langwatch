Feature: An automation's dataset action against a dataset whose columns changed

  An "add to dataset" automation saves its column mapping when it is created.
  The dataset can lose a column afterwards, and the dataset module refuses any
  row that names a column it does not define. The automation keeps writing the
  columns the dataset still has, and a refusal no redelivery can change ends
  the dispatch instead of retrying it.

  @unit
  Scenario: A stale mapping column is dropped and the row is still written
    Given an automation whose mapping names the columns "question" and "input"
    And its dataset now defines only "question"
    When a confirmed match is written to the dataset
    Then the row is written with "question" only
    And one warning names the trigger, the dataset and the dropped column "input"
    And the warning carries no record values

  @unit
  Scenario: A dataset refusal of an automation's rows is not retried
    Given an automation that appends matched traces to a dataset
    When the dataset refuses the rows for a column it does not define
    Then the dispatch fails as terminal and is not redelivered
    And a failure the dataset did not name stays retryable

  @unit
  Scenario: A dataset that is gone or archived is not retried
    Given an automation that appends matched traces to a dataset
    When the dataset is gone or archived
    Then the dispatch fails as terminal and is not redelivered

  @unit
  Scenario: A row left with no dataset column is not written
    Given an automation whose mapping names only columns the dataset no longer has
    When a confirmed match is written to the dataset
    Then no row is written
    And the dropped columns are warned about
    And the dispatch fails as terminal and is not redelivered
