Feature: The dataset content migration scans projects through their owner
  The one-off move of postgres-layout dataset content into object-storage chunks
  walks every project on the install. It reads the project ids from the project
  module a page at a time rather than querying the project table itself.

  @unit
  Scenario: The content migration visits every project across id pages
    Given an install whose project ids span three pages
    When the dataset content migration runs
    Then it reads each page after the cursor the previous page named
    And it looks for postgres-layout datasets in every project once

  @unit
  Scenario: A failed project-id read fails the content migration run
    Given the project module refuses to read the project ids
    When the dataset content migration runs
    Then the run fails with that error rather than reporting a completed summary

  Rule: The content move runs as a background upgrade step

    @unit
    Scenario: The content move resumes after the last project it finished
      Given the content move saved a checkpoint after a project
      When the step runs again
      Then it moves only the datasets of the projects after the saved one

    @unit
    Scenario: An aborted content move keeps the last finished project as its cursor
      Given the content move is aborted part way through a project
      When it stops
      Then that project is not reported finished, so a resumed run moves it again

    @unit
    Scenario: A dry run of the content move writes nothing
      When the content move runs as a dry run
      Then it counts the datasets that would move
      And no chunk is written and no dataset is committed

    @unit
    Scenario: A dataset that fails to move keeps the content move unfinished
      Given a dataset in one project fails to move
      When the content move runs as an upgrade step
      Then the step fails instead of being recorded done
      And its checkpoint stays before that project

    @unit
    Scenario: A retry of an unfinished content move completes it
      Given the content move failed on a dataset and kept its checkpoint before it
      When the step runs again from that checkpoint
      Then it moves the dataset it left behind and is recorded done

    @unit
    Scenario: A dataset skipped for a concurrent write keeps the content move unfinished
      Given a dataset's records change while the content move copies them
      When the content move runs
      Then the run reports itself incomplete
      And its checkpoint stays before that project


  Rule: The content move copies the previous release's single-file datasets in the same pass

    @unit
    Scenario: A single-file dataset is copied into chunks and keeps its file
      Given a dataset the previous release stored as one file in object storage
      When the content move runs as an upgrade step
      Then the dataset's records are readable from its chunks in the order the file held them
      And the dataset reads from chunks from now on
      And the original file is unchanged

    @unit
    Scenario: A single-file dataset already copied is not copied again
      Given the content move already copied a single-file dataset
      When the step runs again
      Then it writes no chunk and reports nothing converted

    @unit
    Scenario: A single-file dataset whose file is missing is skipped and reported
      Given a single-file dataset whose file the previous release never wrote
      When the content move runs as an upgrade step
      Then the step completes and lists that dataset as missing in its report
      And the dataset stays on its previous layout

    @unit
    Scenario: A single-file dataset whose file is not a record array is skipped and reported
      Given a single-file dataset whose file holds text that is not a record array
      When the content move runs as an upgrade step
      Then the step completes and lists that dataset as unreadable in its report

    @unit
    Scenario: A dry run of the single-file copy writes nothing
      Given a dataset the previous release stored as one file in object storage
      When the content move runs as a dry run
      Then it counts the dataset as one it would copy
      And no chunk is written, no checkpoint is saved and the dataset keeps its layout

    @unit
    Scenario: A resumed single-file copy continues after its checkpoint and keeps the skipped list
      Given the content move saved a checkpoint after a project, listing a skipped dataset
      When the step runs again from that checkpoint
      Then it copies only the single-file datasets of later projects
      And its report still lists the dataset skipped before the checkpoint

    @unit
    Scenario: Single-file datasets the previous release kept on local disk are read from its storage path
      Given the deployment says the previous release stored datasets on local disk at a path
      When the content move reads a single-file dataset
      Then it reads the file at that path under the project and dataset ids
      And a dataset with no file there is reported missing
