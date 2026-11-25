Feature: Projects page by cursor with whether they keep their own S3 bucket
  The object-storage provider migration reads every project on the install with
  whether it names a bucket of its own, a page at a time, through the project
  module rather than the Project table. A global move leaves those projects out.
  Projects come ordered by id, archived ones included.

  @unit
  Scenario: Reads every project with its private-bucket flag when no limit is given
    Given an install with three projects, one of them naming its own S3 bucket
    When a peer reads the projects with their private-bucket flag without a limit
    Then all three arrive in id order and only the one with a bucket is flagged, and the next cursor is null

  @unit
  Scenario: Reads a page of projects with their private-bucket flag and the cursor that continues it
    Given an install with three projects
    When a peer reads the projects with their private-bucket flag after the first id with a limit of one
    Then the second arrives and the next cursor is the second id
