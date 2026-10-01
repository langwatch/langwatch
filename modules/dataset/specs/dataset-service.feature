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
  Scenario: A dataset evaluation finds its dataset by slug alone
    Given a project holding a dataset with the slug "golden-set"
    When a dataset evaluation names "golden-set"
    Then that dataset comes back, archived or not
    And the dataset's id is not read as its slug
    And another project's lookup answers no dataset

  @unit
  Scenario: A dataset evaluation records each scored entry as a batch-evaluation row
    Given a dataset evaluation that scored one entry inside an experiment
    When the row is recorded
    Then the experiment's batch-evaluation records hold it beside the dataset it ran over

  @integration
  Scenario: The memory and Postgres dataset repositories answer alike
    Given the same datasets and entries written to each backend
    When the same reads, archives, pages and deletes run against every backend
    Then each answers the same rows, the same absences and the same totals
    And neither answers with a dataset belonging to another project

  @unit
  Scenario: The dataset transports move without changing who may call them
    Given the dataset, dataset record and batch record tRPC surfaces
    When the process mounts them
    Then every procedure keeps the name its callers already use
    And every procedure keeps the access decision it declared before the move

  # Where the declared check reads its scope from is the tRPC runtime's own
  # promise now, stated once at
  # packages/api/specs/transport-declaration-split.feature: "A tRPC check reads
  # the validated input, never the unparsed request". The dataset procedures
  # declare the grant; they no longer wire the check.

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

  @unit
  Scenario: An optional dataset lookup reports an unavailable selection
    Given a dataset lookup that the service says is unavailable
    When the get-by-id transport reads that selection
    Then it answers null
    And it preserves found values and unexpected failures

  @unit
  Scenario: An optional dataset page reports an unavailable selection
    Given a dataset page lookup that the service says is unavailable
    When the paginated-records transport reads that selection
    Then it answers null
    And it preserves found rows, ordering, totals, and unexpected failures

  @unit @regression
  Scenario: A dataset update is pinned to the caller's project
    Given a dataset in the caller's project
    When the caller renames it or changes its columns
    Then the stored update matches the dataset by its id and its project
    And the multitenancy guard lets the update through

  @unit @regression
  Scenario: An import naming a stored object id no store can hold is refused as invalid input
    Given an import request whose storedObjectId contains a NUL character
    When it is validated at the contract
    Then it is refused before any dataset or store is queried

  Rule: The Datasets pages are served from the browser application

    # The application keeps everything a browser module may not own: which grant each
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
