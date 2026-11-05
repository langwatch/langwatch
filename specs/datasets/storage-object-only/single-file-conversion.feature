# Epic: dataset content lives only in object storage, as chunks.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention).
#
# A closed, dormant set of datasets from before ADR-032 keep their rows as ONE JSON array, in the
# project's object storage at datasets/<project>/<dataset> or on local disk under
# LOCAL_STORAGE_PATH when DATASET_STORAGE_LOCAL was set
# (modules/dataset/specs/dataset-single-file.feature, rules/dataset-single-file.rules.ts:16-23).
# They have no records-table rows, so the Postgres move skips them on purpose
# (prisma.dataset-migration.repository.ts:40-41, "A legacy single-blob dataset is left readable,
# not emptied" in specs/datasets/large-dataset-storage.feature). Nothing converts them today, so
# the single-file reader, writer and every `useS3` branch cannot be deleted. The provider-to-provider
# storage migration also skips them (modules/stored-object/process/src/services/object-storage-migration.service.ts:374).
#
# Proposed step: "dataset:convert-single-file-datasets", kind data, mode background,
# needsOldWritersGone true. Each dataset is converted inside the dataset lock the single-file
# writer already takes (services/dataset-single-file.service.ts:265), which the set's size allows.

Feature: Single-file datasets are converted to chunks
  As a LangWatch operator
  I want the datasets stored as one file by an older release converted to chunks
  So that every dataset is stored the same way and the old single-file code can be removed

  Background:
    Given an installation with object storage configured

  Rule: A background upgrade step converts each single-file dataset, keeping its rows

    # becomes @unit
    @unimplemented
    Scenario: A single-file dataset in object storage is converted to chunks with the same rows
      Given a single-file dataset in object storage holding 3 records with ids "r1", "r2" and "r3"
      When the single-file conversion step runs
      Then the dataset reads "r1", "r2" and "r3" in that order from its chunks
      And the dataset is marked as stored in object storage with a row count of 3
      And the dataset is no longer marked as a single-file dataset

    # becomes @unit
    @unimplemented
    Scenario: A single-file dataset on local disk is converted too
      Given DATASET_STORAGE_LOCAL is set and a single-file dataset is on local disk with 2 records
      When the single-file conversion step runs
      Then the dataset reads its 2 records from its chunks

    # The single-file reader writes an id into a record stored without one, so the record keeps
    # that id on every read ("A single-file record stored without an id keeps one id").
    # becomes @unit
    @unimplemented
    Scenario: A record stored without an id keeps the id it was already shown with
      Given a single-file dataset holding a record stored without an id
      And the dataset was read once, showing that record with an id
      When the single-file conversion step runs
      Then the converted record carries the id it was shown with

    # The recorded count (s3RecordCount, schema.prisma:2207) is what the list shows today.
    # becomes @unit
    @unimplemented
    Scenario: The converted dataset counts the rows it actually holds
      Given a single-file dataset whose recorded count is 10 but whose file holds 8 records
      When the single-file conversion step runs
      Then the dataset's row count is 8
      And the step's report names the dataset as having had a wrong recorded count

    # becomes @unit
    @unimplemented
    Scenario: The old single file is kept after conversion
      Given a single-file dataset in object storage
      When the single-file conversion step converts it
      Then the old single file is left where it was
      And the step's report counts it among the old files left for removal

  Rule: A dataset the step cannot read is left as it was, never emptied

    # The reader treats a missing file as an empty dataset ("A single-file dataset whose file is
    # missing reads as empty"); converting that would turn a lost file into an empty dataset.
    # becomes @unit
    @unimplemented
    Scenario: A single-file dataset whose file is missing is not converted
      Given a single-file dataset whose recorded count is 21 and whose file is not there
      When the single-file conversion step runs
      Then the dataset stays a single-file dataset
      And the step's report names it as missing its file
      And the step is not recorded done

    # becomes @unit
    @unimplemented
    Scenario: A single-file dataset whose file is not a list of records is not converted
      Given a single-file dataset whose file is not a JSON array of records
      When the single-file conversion step runs
      Then the dataset and its file are left as they were
      And the step fails naming the dataset, so it retries from its checkpoint

    # becomes @unit
    @unimplemented
    Scenario: A write to a single-file dataset waits while it is converted
      Given the single-file conversion step is converting a dataset
      When a row is added to that dataset
      Then the row is added after the conversion, to the dataset's chunks
      And the dataset holds every row it had plus the new one

  Rule: The conversion is resumable and reports what it would do

    # becomes @unit
    @unimplemented
    Scenario: The conversion resumes after the last project it finished
      Given the single-file conversion step saved a checkpoint after a project
      When the step runs again
      Then it converts only the single-file datasets of the projects after the saved one

    # becomes @unit
    @unimplemented
    Scenario: A dry run of the conversion writes nothing
      When the single-file conversion runs as a dry run
      Then it counts the datasets it would convert and the records they hold
      And no chunk is written and no dataset is changed

    # becomes @integration
    @unimplemented
    Scenario: A converted dataset reads the same through the REST API
      Given a single-file dataset with 3 records
      When the single-file conversion step runs
      Then reading the dataset through the REST API returns the same 3 records with the same ids and entries as before
