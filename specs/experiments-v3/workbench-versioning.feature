Feature: Versioned workbench saves

  Every write to an evaluations workbench goes through one server-owned seam,
  whoever makes it: a person typing, the assistant, or an API caller. The seam
  validates the state, refuses a save that is built on a version somebody else
  already replaced, advances a version counter, and records a version row.

  Ordinary typing keeps one rolling autosave row so a long editing session does
  not bury the versions that mean something. A named commit, an assistant write
  and a restore each add a numbered row.

  @regression @integration
  Scenario: A save that names an old version is refused before anything is written
    Given an evaluation was saved and its version advanced
    When a client saves again naming the version it read before that save
    Then the save is refused as stale
    And the stored state and version are unchanged

  @regression @integration
  Scenario: A save with no expected version advances the counter
    Given an evaluation at some version
    When a client saves without naming a version
    Then the stored version is one higher

  @regression @integration
  Scenario: Repeated typing keeps a single rolling autosave row
    Given a person saves an evaluation several times with no commit message
    When the version rows are listed
    Then exactly one autosaved row exists
    And its version matches the evaluation's current version

  @regression @integration
  Scenario: A commit creates a numbered version with its message
    Given an evaluation with a saved state
    When the caller commits it with a message
    Then a new version row exists that is not an autosave
    And it carries the message

  @regression @integration
  Scenario: An assistant write is recorded as its own version
    Given an evaluation with a saved state
    When the assistant saves through the seam
    Then a new version row exists that is not an autosave
    And it is attributed to the assistant

  @regression @integration
  Scenario: A restore writes the old state forward
    Given an evaluation with an earlier version
    When the caller restores that version
    Then the current state matches the restored version
    And the earlier version row is still in the list
    And the current version is higher than both

  # A snapshot holds the setup only, so writing one back on its own would clear
  # the output cells and evaluator scores of the run the evaluation holds now,
  # and history never kept them to bring back. A restore changes what the
  # evaluation will run, not what it ran.
  @regression @integration
  Scenario: A restore keeps the current run's results
    Given an evaluation with an earlier version and a completed run
    When the caller restores that version
    Then the setup comes from the restored version
    And the run's cells are still there

  # Both writers read the same stored version, so the version check the seam
  # makes before the write cannot tell them apart. Only the compare-and-set can:
  # the second update matches no row and is refused.
  @regression @integration
  Scenario: Two saves that race are not both accepted
    Given two saves of one evaluation that both read the same version
    When they reach the database together
    Then one is accepted and the other is refused as stale
    And the stored state is the accepted one

  # The loser read one version and the winner left another behind. Reporting
  # the version the loser read would send it back to a version the server has
  # already left, and it would save into the same refusal again.
  @regression @integration
  Scenario: A refusal names the version the server holds now
    Given two saves of one evaluation that both read the same version
    When the second is refused after the first was accepted
    Then the refusal carries the version the first save created

  # A workflow evaluation moves the counter without writing a version row, so
  # the newest row can describe an older version. Naming its author would
  # credit a person for a write the platform made.
  @regression @integration
  Scenario: A version with no row of its own names nobody
    Given an evaluation whose counter moved without a version row
    When a caller reads the workbench state
    Then no author is named

  @regression @integration
  Scenario: An archived evaluation refuses a save
    Given an evaluation that was archived
    When a stale client saves with its id
    Then the save is refused as not found
    And the archived row is unchanged

  @regression @integration
  Scenario: A save cannot reach another project's evaluation
    Given an evaluation in another project
    When a caller saves it naming its own project
    Then the save is refused as not found

  @regression @unit
  Scenario: A state that does not match the schema is refused
    When a caller saves a state with a missing required field
    Then the save is refused as an invalid workbench state

  @regression @unit
  Scenario: A state pointing at a row that no longer exists is refused
    When a caller saves a state naming a deleted prompt, agent, evaluator, workflow or dataset
    Then the save is refused and names which kind of row and which id is missing

  # A target keeps every id it ever held, because the workbench merges target
  # edits field by field. The run reads only the id that matches the target's
  # own type, so checking the others would refuse a save the run would accept.
  @regression @unit
  Scenario: A reference the run would not read is not checked
    Given a target changed to another type that still carries its old id
    When it is saved
    Then the save is accepted

  @regression @unit
  Scenario: A reference the run would read is still checked
    Given a target whose own type names a row that no longer exists
    When it is saved
    Then the save is refused and names that reference

  # These endpoints serialise a handled error only, so a plain error answered a
  # type mismatch with a 500 and a trace id instead of the documented 400.
  @regression @unit
  Scenario: A workbench call on another kind of experiment is refused with a code
    Given an experiment that is not an evaluations workbench
    When a caller reads or writes its workbench state
    Then the call is refused with the type-mismatch code and a 400

  @regression @unit
  Scenario: Run results are not stored in the version snapshot
    Given a state that carries run results
    When it is saved
    Then the version snapshot holds the setup without the results

  @regression @integration
  Scenario: A run stops when a target's agent was deleted
    Given an evaluation whose target names an agent that no longer exists
    When the run loads its execution data
    Then the run fails and names the missing agent

  @regression @integration
  Scenario: A run stops when an evaluator was deleted
    Given an evaluation whose evaluator no longer exists
    When the run loads its execution data
    Then the run fails and names the missing evaluator

  Rule: The numbers a reader follows count the deliberate versions

    Every accepted save moves the setup counter, and typing moves it several
    times a minute. Numbering the history by that counter put "v20" directly
    above "v1" after twenty minutes of work, because the nineteen saves in
    between all landed on the one autosave row and took a number with them.

    A number now says which deliberate version this is: a commit, an assistant
    write and a restore each take one more than the highest number the
    evaluation holds. The autosave row is not one of them, so it is shown as an
    autosave and its number is a handle for a restore, not a place in the list.
    The counter still guards every write and still says which row is the newest.

    @regression @integration
    Scenario: Typing between two commits leaves no gap in the numbers
      Given an evaluation created, committed, typed on several times, and committed again
      When the numbered versions are read
      Then they read v1, v2 and v3, with nothing missing between them

    @regression @integration
    Scenario: The newest version is the one written last
      Given an evaluation committed after a session of typing
      When the versions are listed
      Then the second commit is first, the autosave next, and the older versions after it

    @regression @integration
    Scenario: The autosave row and the numbered versions never take the same number
      Given a person saves an evaluation once with no commit message
      When the caller commits a version straight after
      Then both rows are still there, each with its own number

    @regression @integration
    Scenario: A restore of the autosave says so instead of naming a number
      Given a version history holding an autosave
      When the caller restores that row
      Then the version the restore writes reads "Restored from the autosave"

  Rule: Every run writes its cells into the saved state

    A run started over REST, from the command line or by the assistant has no
    page to stream its cells to, so the workbench state knew nothing about them
    and the table read "No output yet" after the run finished. The runner
    writes the cells back through the same route every other write uses, and
    the update signal lets an open page pick them up.

    A run started from an open page has the same result for a different reason.
    The page holds the cells and saves them itself, so a tab the browser puts
    to sleep, or a connection that drops before the last frame, leaves the run
    complete in its own record while the board still reads "No output yet".
    The streaming route writes the cells back the same way the runner does, so
    the board no longer depends on the tab. A page that started the run reads
    the version it wrote as its own and takes it, which the adopt rule below
    covers.

    @regression @integration
    Scenario: A completed backend run fills the cells the workbench shows
      Given an evaluation whose saved state carries no results
      When a backend run of every row completes
      Then the saved state holds each row's output, its metadata and its evaluator results
      And the stored version is higher than before the run

    @regression @integration
    Scenario: A run of some rows keeps the cells of the rows it did not run
      Given an evaluation whose saved state already holds results for every row
      When a backend run of one row completes
      Then that row's cells carry the new output and the other rows keep theirs

    @regression @unit
    Scenario: A run given its own rows or parameters is not written back
      Given run inputs that replace or override the saved dataset
      When the run decides whether to write its cells back
      Then it writes nothing back, and a plain run or a row subset writes back

    @regression @integration
    Scenario: A failure to write the cells back does not fail the run
      Given a saved state that cannot be written
      When a backend run completes
      Then the run still reports completed

    # The rows that finished before the stop are the run's whole output.
    # Dropping them leaves the table reading "No output yet" for work that ran.
    @regression @integration
    Scenario: A stopped backend run keeps the cells it already produced
      Given a backend run that filled some cells
      When the run is stopped
      Then the saved state holds the cells it produced before the stop

    # The engine reports a cell that failed as its own event rather than as a
    # result with an error on it. A run where every cell fails still has to
    # reach the table: a workbench that reads "No output yet" after a failed
    # run tells the user nothing happened, when in fact everything did and
    # everything broke.
    @regression @unit
    Scenario: A run whose cells all fail writes those failures into the cells
      Given a backend run whose every cell fails
      When the run completes
      Then each failing cell carries its failure in the saved state
      And an evaluator that failed carries its own failure on its cell

    @regression @unit
    Scenario: A failure that names no cell leaves the cells alone
      Given a backend run that fails before any cell runs
      When the run completes
      Then no cell is marked, because the run's own status carries the failure

    @regression @integration
    Scenario: A run started from the open page writes its cells too
      Given a run started from an open workbench page
      When the run completes
      Then the server writes the run's cells into the saved state
      And the version it writes names the run

    @regression @integration
    Scenario: A stopped run started from the open page keeps the cells it produced
      Given a run started from an open workbench page that filled some cells
      When the run is stopped
      Then the server writes the cells it produced into the saved state

    @regression @integration
    Scenario: A run started from the open page with its own rows is not written back
      Given a run started from an open workbench page with rows sent in the request
      When the run completes
      Then the server writes nothing into the saved state

    @regression @integration
    Scenario: A run started from a page with no saved experiment is not written back
      Given a run started from an open workbench page that names no experiment
      When the run completes
      Then the server writes nothing into the saved state

    # The frame that names the run is the first one. A stream that ends before
    # it arrives carries no cells either, so there is nothing to write and no
    # run to attribute the write to.
    @regression @unit
    Scenario: A run that ends before it names itself writes nothing
      Given a stream that ends without naming its run
      When the run ends
      Then nothing is written into the saved state

  Rule: The same seam is reachable over REST

    An agent or a CI job builds an experiment without a browser. It creates
    one, reads the setup, saves a new one, lists what was saved and brings an
    old one back — through the same seam, with the same refusals.

    @integration
    Scenario: Creating an experiment over REST gives a workbench you can open
      Given a caller with a project API key
      When it creates an experiment and sends no setup
      Then the experiment starts at version 1 with one empty dataset

    # Only the app-layer's own experiment service carries a broadcaster, so a
    # route that builds its own writes the row and tells nobody, and an open
    # experiments list shows the new row only after a reload.
    @regression @integration
    Scenario: A create over REST tells the tenant the list moved
      Given a caller with a project API key
      When it creates an experiment
      Then the tenant gets an experiment update naming the new experiment

    @integration
    Scenario: An agent edits an experiment through the REST surface
      Given an experiment created over REST
      When the caller reads its setup, saves a new one, and restores the first
      Then the history lists both saves and the restore, newest first

    @integration
    Scenario: A poller checks for changes without pulling the setup
      Given an experiment with a saved setup
      When the caller asks for the version field only
      Then it gets the version and the timestamp, and no setup

    @integration
    Scenario: A stale save is refused with the version to read again
      Given an experiment somebody else already saved on top of
      When the caller saves naming the version it read before that
      Then the save is refused and names the version stored now

    @integration
    Scenario: A setup that cannot be read is refused with its code
      Given an experiment with a saved setup
      When the caller saves a setup that does not match the schema
      Then the save is refused with the invalid-setup code

    @integration
    Scenario: An unknown experiment reads as not found
      Given a slug no experiment in this project has
      When the caller reads its setup
      Then the read answers not found

    @integration
    Scenario: A restore of a version that does not exist reads as not found
      Given an experiment with one version
      When the caller restores a version number it never had
      Then the restore answers not found

    @integration
    Scenario: The workbench endpoints refuse an unauthenticated caller
      Given a request carrying no credentials
      When it reaches a workbench endpoint
      Then the request is refused as unauthenticated

    @integration
    Scenario: Each workbench endpoint declares the grain it needs
      Given the route registry
      When the workbench endpoints are read from it
      Then reading declares the view grain and writing declares the update grain

    @unit
    Scenario: A create call with no setup stores a workbench that loads
      Given a create call that sends no setup
      When the blank setup is built
      Then it matches the persisted schema

    @unit
    Scenario: The server blank matches the workbench a browser starts from
      Given the blank setup the server builds
      When it is compared with the workbench a browser starts from
      Then the dataset, its columns, the targets and the evaluators are the same

    @unit
    Scenario: The server blank starts with no rows
      Given the blank setup the server builds
      When its dataset is read
      Then the dataset has no rows

  Rule: The command line drives the same endpoints

    @unit
    Scenario: Creating an experiment from the CLI
      Given the create command with a name
      When it runs
      Then it reports the new slug and version

    @unit
    Scenario: Checking an experiment's version without pulling its setup
      Given the get-state command asked for the version field
      When it runs
      Then it reports the version and does not pull the setup

    @unit
    Scenario: Saving a setup from a file
      Given the set-state command pointed at a file holding a setup
      When it runs with an expected version and a message
      Then the setup is sent with both

    @unit
    Scenario: Listing an experiment's versions
      Given the versions command
      When it runs
      Then it prints a row per version naming who saved it

    @regression @unit
    Scenario: The command line names the autosave instead of numbering it
      Given the versions command on a history that holds an autosave
      When it runs
      Then the autosave row reads "autosave" and the others read their numbers

    @unit
    Scenario: Restoring an experiment version from the CLI
      Given the restore command with a version number
      When it runs
      Then it restores that version and reports the version the restore wrote

  Rule: The workbench shows its own history

    # The history is a short list a reader checks and leaves, so it opens on
    # the button that asks for it and the workbench stays visible behind it. It
    # was a drawer, which covered the setup the versions describe.

    @integration
    Scenario: The history opens on the button that asks for it
      Given an experiment with saved versions
      When the reader clicks the history button
      Then the history opens anchored to that button
      And clicking the button again closes it

    # Anchoring is not decoration: the first version of this shipped with a
    # tooltip wrapped around the trigger, both claimed the same button, and the
    # history opened at the top-left corner of the window while the button sat
    # at the far right. It looked wired up, because the button still carried the
    # popover's own class and placement.
    @integration
    Scenario: The history is anchored to the button that opens it
      Given an experiment with saved versions
      When the reader opens the history
      Then the button that opened it is the history's own trigger
      And no other component has taken that button over

    @integration
    Scenario: The history closes once a restore lands
      Given the version history is open
      When the reader confirms a restore
      Then the history closes

    @integration
    Scenario: The version history names each version and who saved it
      Given an experiment with saved versions
      When the version history opens
      Then each row names the version, its author and when it was saved

    @regression @integration
    Scenario: The version history shows the autosave as an autosave
      Given an experiment whose history holds an autosave
      When the version history opens
      Then that row reads "Autosave" and carries no version number

    @regression @integration
    Scenario: The current badge marks the version the workbench holds
      Given an experiment whose newest version is the one open in the workbench
      When the version history opens
      Then that row carries the current badge and offers no restore

    @integration
    Scenario: A restore asks for confirmation first
      Given the version history is open
      When the reader clicks restore on a version
      Then nothing is restored until the reader confirms

    @integration
    Scenario: Restoring a version reloads the workbench
      Given the version history is open
      When the reader confirms a restore
      Then the restored setup is loaded into the workbench

    @integration
    Scenario: Restore is not offered without the permission
      Given a reader who cannot update experiments
      When the version history opens
      Then no row offers a restore

  Rule: A save refused for a newer version is reported as out of date, not as a failure

    Nothing is lost when the seam refuses a save: the write never happened and
    the newer version is one reload away. Reporting it as a failed save tells
    the reader their work is gone, which is the opposite of what took place, and
    it reads worst exactly when it is most common, after the assistant saves a
    version of its own.

    @integration
    Scenario: The toolbar names the reason a save was refused
      Given an open workbench whose save was refused for a newer version
      When the reader looks at the save status
      Then it reads that the workbench is out of date

    @integration
    Scenario: A save that truly failed is still reported as a failure
      Given an open workbench whose save failed for any other reason
      When the reader looks at the save status
      Then it reads that the save failed

  Rule: A page adopts a version its own run wrote

    A run writes its cells into the workbench state, which advances the counter.
    The page that started that run holds every cell the run produced already,
    because it streamed them. Reading its own run's bump as somebody else's
    write stands autosave down and asks the reader to reload over edits the run
    had nothing to do with.

    Taking the version is the part that matters. A page that only skipped the
    warning would keep sending the version it had, and the next save would be
    refused for the same reason one save later.

    @regression @integration
    Scenario: A version a run wrote names that run
      Given a run that writes its cells into the workbench state
      When the version rows are listed
      Then the version the run wrote names the run

    @regression @integration
    Scenario: A refusal names the run that wrote the newer version
      Given a run wrote its cells after a client read the workbench
      When that client saves naming the version it read
      Then the refusal names the run that wrote the newer version

    @integration
    Scenario: A page takes a version its own run wrote
      Given a page that started a run and has unsaved edits
      When a version that run wrote arrives
      Then the page takes that version
      And it does not ask the reader to reload

    @integration
    Scenario: A page still stands down for a version somebody else wrote
      Given a page that started a run and has unsaved edits
      When a version somebody else wrote arrives
      Then the page asks the reader to reload

    @integration
    Scenario: A refused save whose newer version came from this page's own run is sent again
      Given a page that started a run and has unsaved edits
      When its save is refused for the version that run wrote
      Then the page takes that version and sends its edits again
      And it does not stand autosave down
