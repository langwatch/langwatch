Feature: Single-file datasets keep working where the previous release kept them
  The previous release stored some datasets as one JSON array of records: in the
  project's object storage at datasets/<project>/<dataset>, or on local disk at
  <LOCAL_STORAGE_PATH>/<project>/<dataset> when DATASET_STORAGE_LOCAL was set.
  They are not migrated. Every record operation reads and rewrites that file in
  place, in the same shape, and keeps the dataset's recorded count beside it.

  Rule: The file is found where the previous release wrote it

    @unit
    Scenario: Single-file datasets in object storage live at the previous release's key
      Given the previous release kept a dataset in object storage
      When the dataset module reads or writes it
      Then it uses the object at datasets/<project>/<dataset> in the project's storage

    @unit
    Scenario: Single-file datasets on local disk live at the previous release's path
      Given DATASET_STORAGE_LOCAL is set and LOCAL_STORAGE_PATH names a directory
      When the dataset module reads or writes a single-file dataset
      Then it uses the file at <path>/<project>/<dataset>
      And an id that climbs out of that directory is refused

    @unit
    Scenario: A single file on local disk is replaced whole, never left half written
      Given a single-file dataset on local disk
      When the dataset module rewrites it
      Then the new contents are written beside it and moved over it in one step
      And no partial or temporary file is left behind

  Rule: Records are read from the file

    @unit
    Scenario: Single-file dataset records are read from the file the previous release wrote
      Given a single-file dataset holding three records
      When a caller lists a page, previews the head or reads the dataset whole
      Then the records come from the file in stored order
      And the total is the number of records in the file
      And each record shows the timestamps stored with it, or the dataset's when it has none

    @unit
    Scenario: Single-file dataset records are searched in the file
      Given a single-file dataset holding three records
      When a caller searches for text one record holds
      Then the page holds only that record and counts one match

    @unit
    Scenario: Searching a single-file dataset larger than one search may read is refused
      Given a single-file dataset whose file is larger than the organization's whole-read limit
      When a caller searches it
      Then the search is refused as too large to search, without the file being read whole

    @unit
    Scenario: A single-file record stored without an id keeps one id
      Given a single-file dataset holding a record stored without an id
      When a caller reads the dataset twice
      Then the record shows the same id both times, written into the file
      And deleting that id removes the record

    @unit
    Scenario: A single-file dataset whose file is missing reads as empty
      Given a single-file dataset whose file is not there
      When a caller reads it
      Then it reads as a dataset with no records
      And adding a record creates the file

    @unit
    Scenario: A single-file dataset whose file is unreadable refuses rather than overwriting it
      Given a single-file dataset whose file is not a JSON array of records
      When a caller reads it or adds a record
      Then the operation fails
      And the file is left as it was

  Rule: Records are written by rewriting the file

    @unit
    Scenario: Single-file dataset records are added, updated and deleted in the file
      Given a single-file dataset holding three records
      When a caller adds records, edits one, edits an id the file lacks and deletes one
      Then the file holds the result in the previous release's record shape
      And the dataset's recorded count matches the file
      And the dataset stays on its single file with nothing in the record table

    @unit
    Scenario: A failed count update leaves the single file as it was
      Given a single-file dataset holding three records
      When a caller adds a record and recording the dataset's count fails
      Then the operation fails
      And the file still holds the three records

    @unit
    Scenario: Deleting ids a single-file dataset does not hold is refused
      Given a single-file dataset
      When a caller deletes only ids the file does not hold
      Then the delete is refused as not found

    @unit
    Scenario: A file uploaded to a single-file dataset is appended to its file
      Given a single-file dataset holding three records
      When a caller uploads a file of two rows to it
      Then the two rows are appended to the single file

    @unit
    Scenario: A single-file dataset copies its records into the new dataset
      Given a single-file dataset holding three records
      When a caller copies it
      Then the copy holds the same three entries

  Rule: Other datasets are unaffected

    @unit
    Scenario: Datasets in today's layouts never read a single file
      Given a dataset in today's layout and a file at the old key for its id
      When a caller reads the dataset
      Then the records come from the dataset's own storage, not the file
