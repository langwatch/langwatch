Feature: A dataset record names columns the dataset defines

  Batch record creation fills each entry out to the dataset's own columns and
  writes only those. A key the dataset does not define therefore has nowhere
  to go: it was dropped on the way to storage and the caller read a success
  for data nothing kept — a typo in a column name looked like a working
  integration until somebody opened the dataset.

  The refusal is knowable and the caller can act on it (fix the key, or add
  the column), so the service raises it rather than the door guessing. The
  REST door already answered it as a 400; nothing raised it any more.

  Validation runs before the storage split, so an inline dataset and an
  s3_jsonl one refuse the same entry.

  @unit
  Scenario: An entry naming a column the dataset does not define is refused
    Given a dataset whose columns are input and output
    When records are created with an entry that also names a column called notes
    Then the creation is refused as an invalid column
    And the refusal names the offending column and the columns that are valid
    And nothing is written to the record store

  @unit
  Scenario: An entry naming only some of the dataset's columns is accepted
    Given a dataset whose columns are input and output
    When records are created with an entry that names only input
    Then the record is written with the missing column left empty

  @unit
  Scenario: A record identifier is not treated as a column
    Given a dataset whose columns are input and output
    When records are created with an entry that carries its own record id
    Then the record is written under the identifier the caller supplied
