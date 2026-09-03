Feature: Shared Dataset service
  Dataset and Dataset Record behaviour is one process-owned capability.

  Scenario: A dataset is created with a portable contract
    Given the process has one Dataset service
    When a caller creates a dataset for a project with columns and records
    Then the service validates the input with the Dataset contract
    And it returns a portable Dataset value
    And the records are written through the Dataset record repository

  Scenario: Dataset names remain unique within a project
    Given a dataset already exists with the slug "golden-set"
    When a caller validates the name "Golden Set"
    Then the result reports the name as unavailable
    And it identifies the conflicting dataset

  Scenario: A dataset lookup is tenant-scoped
    When a caller looks up a dataset using another project id
    Then the service throws DatasetNotFoundError
    And it does not return the other project's dataset

  Scenario: Records use the Dataset boundary
    When a caller creates, updates, lists, or deletes records
    Then the service checks that the Dataset is ready
    And it delegates persistence to the Dataset record repository
    And it does not expose Prisma records

  Scenario: Dataset copy remains a Dataset operation
    When a caller copies a dataset to another project
    Then the service creates the target through its own repository
    And it copies records through the Dataset record repository
    And it does not construct a Dataset Record feature

  Scenario: Compatibility transports share one service
    When the tRPC or REST Dataset transport handles a request
    Then it reads the process-owned Dataset service
    And it does not construct a service or repository per request

  Scenario: Upload storage remains an injected Dataset seam
    When an upload is normalized or S3 JSONL chunks are rewritten
    Then the Dataset service uses injected storage and queue capabilities
    And it does not import an object-store client or global Prisma

  @unit
  Scenario: The dataset transports move without changing who may call them
    Given the dataset, dataset record and batch record tRPC surfaces
    When the process mounts them
    Then every procedure keeps the name its callers already use
    And every procedure keeps the access decision it declared before the move

  @unit
  Scenario: The declared check reads the validated input
    Given a procedure authorized at the project its input names
    When a permitted caller calls it
    Then the authorization check resolves its scope from the parsed input
    And the scope lineage guard is given the same input
    And no procedure answers before a check has run

  @unit
  Scenario: A copy is refused when the source project is not the caller's
    Given a caller permitted on the target project
    When they copy a dataset out of a project they may not read
    Then the copy is refused
    And nothing is read from the source project

  @unit
  Scenario: A still-preparing dataset refuses record reads and writes
    Given a dataset whose contents are still being prepared
    When a caller reads or writes its records
    Then the transport refuses it as a client precondition failure
    And it does not report a server fault

  Rule: The Datasets pages are served from the browser application

    # Both pages moved out of platform/app with the family. What the application
    # keeps is everything a feature-web package may not own: which grant each
    # address is behind, the transport, where a dataset may be replicated to,
    # and the reader's membership.

    @unit
    Scenario: The datasets page is behind the grant its platform page asked for
      Given a reader holds a grant the datasets page does not ask for
      When they open the datasets address
      Then the page does not render
      And the refusal names the grant they are missing
      # datasets:view, carried over one for one from the platform page's
      # permission guard. Widening it here would admit a reader the platform
      # page refused.

    @unit
    Scenario: One dataset's editor opens for anyone who can reach the project
      Given a reader holds no dataset grant at all
      When they open one dataset's address
      Then the editor renders
      # The platform page carried no permission guard: it read a grant only to
      # decide whether to offer the experiment hand-off. Adding one here would
      # break every deep link into a dataset that works today.

    @unit
    Scenario: Replication targets are the teams the reader may create datasets in
      Given the reader belongs to a team whose role does not allow creating datasets
      When the replication picker is offered
      Then that team's projects are not listed
      And a team the reader holds no membership on contributes no projects at all

    @unit
    Scenario: The lite membership role is answered by the application, not inferred
      Given the reader holds the lite membership role
      When the datasets list renders a row's actions
      Then editing and deleting are not offered
      And replicating to another project still is

    @integration
    Scenario: The editor waits for the dataset's status before it reads any records
      Given the dataset read has not settled yet
      When the editor page renders
      Then the record grid is not mounted
      And the reader is told the dataset will appear once it is ready
      # An unsettled status reads as null, and null means "born before the
      # column", so mounting on it would read records from a dataset that may
      # still be processing.

    @integration
    Scenario: A dataset that failed to prepare names the reason and offers a retry
      Given a dataset whose preparation failed
      When the editor page renders
      Then the reader is shown why it failed
      And they are offered a retry
      And the record grid is not mounted
