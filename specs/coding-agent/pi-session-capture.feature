Feature: pi session capture

  pi emits no OpenTelemetry, so a person running pi on their own machine sends
  nothing to LangWatch today. pi does keep its own record of each session on
  disk: a first line carrying the session id and working directory, then a row
  per event. Rows are of several kinds, and only the assistant's replies carry a
  model, a provider and a cost.

  Two things about that file shape what capture may assume. pi holds the opening
  of a session in memory and creates the file only when the first assistant
  reply arrives, so a session abandoned before that leaves no file at all. And
  once the file exists it only ever grows: later runs append, and the bytes
  already written do not change.

  LangWatch reads that file while pi runs. It does not load anything into pi's
  process, because a capture path that lives inside pi can hang or crash the
  user's editor.

  pi is a front end for several model providers. What we record is that the
  person used pi, never which provider pi dialled on their behalf.

  Out of scope here: the internal assistant that drives pi as a subprocess. It
  mints its own session identity and reaches LangWatch by its own route. These
  scenarios cover only sessions a person launches themselves.

  # --- What the user gets ---------------------------------------------------

  # What "shows the conversation" does and does not mean here, because this
  # scenario said more than the code does and its test could not tell.
  #
  # Every turn is recorded, in pi's order, and each carries who spoke, when,
  # which model answered, what it cost and how much text moved. None of them
  # carries the text. A user prompt is recorded with its length, an assistant
  # reply with its model and token counts, a tool result with its name and
  # size. Nobody reading a captured pi session can read what was typed or
  # answered.
  #
  # That is deliberate in the builder, which says so where the text is measured
  # and dropped, and it is also forced: the session record these events fold
  # into has no field to put a conversation in. The agents that do show their
  # conversation put it on a different lane entirely, as spans carrying the
  # message bodies, and pi declines that lane on the stated grounds that its
  # file has no span parentage to honour.
  #
  # So the promise below is turn-by-turn usage, not readable conversation. Both
  # this scenario and the decision record used to claim the second. Carrying
  # pi's message text to the same place the other agents put theirs is issue
  # #8173, which needs a decision about that lane rather than an extra field.
  @unit
  Scenario: A captured pi session records every turn in the order pi wrote them
    Given a pi session with two user prompts, one tool call and two assistant replies
    When the session is captured
    Then all five turns are recorded, in the order pi wrote them
    And each turn names its speaker, its timing and its usage, and carries none of its text

  @unit
  Scenario: The session cost counts assistant turns, work inside tools, and summarised stretches
    Given a pi session with an assistant turn costing 10, work inside a tool costing 3, and a summarised stretch costing 2
    When the session is captured
    Then the session's cost is 15

  @unit
  Scenario: A turn pi charged nothing for is recorded as zero
    Given a pi session with an assistant turn that ended in an error and carries a cost of zero
    When the session is captured
    Then that turn's cost is recorded as zero

  @unit
  Scenario: A turn carrying no cost at all is left blank rather than counted as zero
    Given a pi session with an assistant turn that carries no cost field
    When the session is captured
    Then that turn's cost is left blank

  # --- Reading a file that is still being written ---------------------------

  @unit
  Scenario: Turns appended after a read are picked up by the next one
    Given a pi session file holding three turns
    When the session is captured, two more turns are appended, and it is captured again
    Then all five turns are recorded

  @unit
  Scenario: The same turn is not recorded twice
    Given a pi session whose turns have already been captured
    When the session is captured again
    Then each turn still appears once

  # pi copies the parent's row identifiers into the child when it splits a
  # session, so two files can hold rows with identical identifiers. Removing
  # duplicates by row identifier alone would silently swallow the child's
  # inherited history.

  @unit
  Scenario: Two sessions sharing row identifiers are kept apart
    Given a pi session split off another, where the child's rows carry the same identifiers as the parent's
    When both sessions are captured
    Then each session keeps its own full set of turns

  @unit
  Scenario: A session that stopped without shutting down cleanly keeps the turns pi had written
    Given a pi session with three turns on disk that stopped without shutting down cleanly
    When the session is captured
    Then those three turns are recorded

  @unit
  Scenario: A session abandoned before pi wrote anything records nothing and reports no error
    Given a pi session the user quit before the first assistant reply, for which pi wrote no file
    When capture runs
    Then no session is recorded and no error is raised

  @unit
  # The Then here is the directory we CHOOSE, not a session we read, and the
  # title says so. A scenario that claims a read while its tests only compare a
  # path passes on a promise: the path can be right and the read still never
  # happen. Reading is asserted by the capture scenarios, against a real file.
  #
  # Every row here is a user who named a directory, and pi writes sessions
  # straight into the directory they named. The user who named nothing is not a
  # row: it resolves somewhere else entirely, one level down, and so it is its
  # own scenario below rather than a fourth example with a different Then.
  #
  # "The way pi reads it" is doing work in that Then, and it is not decoration.
  # This scenario said "exactly as they named it" for one commit, which was
  # false and was caught by running it: pi expands a leading tilde before it
  # writes, and we were returning the tilde untouched, so a user whose settings
  # file says `~/pi-sessions` had every session missed in silence. Settings
  # files are the sharp case, since JSON cannot expand a tilde itself, which is
  # why the last row names it.
  #
  # That row names the case; it does not enforce it. The parity checker binds
  # tests to a scenario by its name and has no notion of an example row, so
  # four rows and one row carry the same one obligation. What makes the tilde
  # case fail when the expansion is removed is the test, which was reverted
  # against each of the three sources in turn to prove it.
  Scenario Outline: A session kept somewhere other than the default place is still found
    Given a user who set pi's session directory <how>
    When we work out where to look
    Then we look in that directory, the way pi reads it

    Examples:
      | how                                      |
      | with a command flag                      |
      | with a variable in the environment       |
      | in pi's settings file                    |
      | in pi's settings file, starting at home  |

  @unit
  # A user who has set nothing is the common case, and it used to record
  # nothing at all. A directory the user names is a directory pi writes
  # sessions straight into. The default is not: pi makes one folder per
  # working directory underneath it and writes there, so the default place
  # itself never holds a session file. Looking in it, and not below it, found
  # no file on any tick and ended the run with nothing recorded and nothing
  # said. Measured against a real installation before this was written: no
  # files in the default place, seven in the folders below it.
  #
  # We work out the project folder rather than widening the search from the
  # place above it, so a run still records only the sessions of the project it
  # was started in. Both halves are held by a bound test that builds the real
  # layout and reads it: the session below is captured, and the same capture
  # pointed at the parent gets nothing. Reverting either half fails it, which
  # was checked by reverting each one.
  Scenario: A default pi launch is read from the folder pi makes for this project
    Given a user who has not moved pi's session directory, and a session pi wrote
    When capture runs
    Then that session is recorded
    And the folder we looked in is the one pi makes for the working directory, not its parent

  @unit
  # Naming a file by path is the rare way to reach another project's session.
  # `--resume` is the common one: it opens pi's picker, the picker is fed from
  # every project's sessions as well as this one's, and pi keeps writing
  # whichever is picked in the folder it already lives in. So the session the
  # run is actually having can sit in a sibling folder of the one being watched,
  # and the run records nothing and says nothing.
  #
  # The wider search is one level below the sessions root, which is exactly
  # every project's folder — exactly what pi's picker offered. Deeper is not
  # somewhere pi puts sessions; the root itself holds none.
  #
  # It is opt-in for that one launch, and narrow everywhere else. `--continue`
  # takes the most recent session of THIS project. `--session <id>` either
  # matches locally or forks another project's session into this one. And when
  # the user has moved the session directory, pi's picker lists that single
  # directory and nothing else, so it is already entirely watched.
  #
  # The cost is stated rather than hidden: one level below the root is every
  # project, so a plain `pi` started by hand in a DIFFERENT project during this
  # run is now inside the window too. That is the second-terminal limit this
  # feature already carries, widened from one project to all of them, and it is
  # bounded by the same two filters — the modification window and the per-row
  # clock.
  Scenario: A session resumed from another project is captured where it lives
    Given a launch that lets pi offer sessions from every project
    When the resumed session is written in another project's folder
    Then its turns are recorded
    And a session in that folder untouched since the run began is still left alone

  @unit
  # Resolving the right DIRECTORY is not the whole job, because pi can be told
  # to open one specific FILE. `--session <path>` opens that exact file and pi
  # keeps writing to it where it lies, rather than copying it into the session
  # directory, so a capture that watches only a directory sends nothing and says
  # nothing — the same silent miss the resolver was written to close, one door
  # down.
  #
  # `--session` also takes a session id, and pi tells a path from an id by shape
  # alone: a value containing a separator or ending in `.jsonl` is a path,
  # resolved against the launch directory. The id routes need nothing here,
  # because each of them ends inside the session directory already — a local
  # match is there, and a match in another project is forked into this one
  # rather than opened in place.
  #
  # The named file is watched ALONGSIDE the directory, not instead of it, since
  # a run can open a named session and still create others. It is held to the
  # same window as everything else: a file pi has not appended to since the run
  # began is not this run's, however it was named.
  Scenario: A session pi was told to open by path is captured where it lies
    Given a launch that names one session file outside the session directory
    When capture runs and pi writes to that file
    Then the turns in it are recorded
    And a file nothing has written to since the run began is still left alone

  @unit
  # pi keeps two settings files, not one: a global one in its agent directory
  # and a project one at `.pi/settings.json` in the directory pi was launched
  # from. pi merges them project-over-global, so a project that moves its own
  # session directory moves it for real. Reading only the global file left
  # capture watching the default while pi wrote where the project said — no
  # file to fail on, nothing recorded, nothing said.
  #
  # Trust does not narrow this. pi gates project settings on a trusted project,
  # but the settings manager pi asks for the session directory is built before
  # any trust decision and defaults to trusting, so the project's answer counts
  # either way. Settled by running pi 0.85.1's own settings manager against a
  # project file and a global file naming different directories: it returned the
  # project's.
  Scenario: A session directory the project moved is the one capture reads
    Given a project whose own pi settings name a session directory
    When capture works out where to look
    Then it reads the project's directory, not the one the global settings name

  @unit
  # Reading pi's flags more loosely than pi reads them is the same failure as
  # reading the wrong directory: capture watches a place pi never writes, sends
  # nothing, and says nothing.
  #
  # pi's parser matches whole tokens, one branch per flag, with no pass that
  # splits `--flag=value` first. So `--session-dir=/x` is an unknown flag to pi
  # and pi writes to its default; we honoured it and watched an empty directory.
  # The reverse case is the same bug from the other side: pi takes the token
  # after the flag unconditionally, so `--session-dir --verbose` names a
  # directory called `--verbose` to pi, and refusing to read it left capture on
  # the default while pi wrote somewhere else. `--` ends pi's flag parsing, so a
  # flag behind it names nothing.
  #
  # Settled by calling pi 0.85.1's own parser on each spelling rather than by
  # reading its source: the space form yields the directory, the joined-up form
  # yields nothing and lands in pi's unknown-flag map.
  Scenario: A directory named in a spelling pi ignores does not move capture
    Given a launch whose session directory is written in a spelling pi does not accept
    When capture works out where to look
    Then it looks where pi will actually write, not where the spelling pointed

  # --- Naming the agent, not the provider -----------------------------------

  @unit
  Scenario: The record names pi even though another provider answered
    Given a pi session answered by Anthropic models, where the rows name anthropic as the provider
    When the session is captured
    Then the record names pi as the agent, and no scope or service name contains anthropic

  # --- Not stealing other agents' sessions ----------------------------------

  # The identifier picks an agent by looking for its name inside the incoming
  # signal's scope or service, first match wins. The letters "pi" appear inside
  # both "anthropic" and "copilot", so a match rule of just those letters would
  # claim sessions belonging to other agents.

  @unit
  Scenario: pi's match rule does not fire on a scope or service that merely contains its letters
    Given pi's match rule, tested on its own with the ordering removed
    When it is offered a signal scoped to com.anthropic.claude_code.events and one whose service is copilot
    Then it claims neither

  @unit
  Scenario Outline: An existing agent's session is not relabelled as pi
    Given an incoming <agent> session
    When the agent is identified
    Then it is identified as <agent>

    Examples:
      | agent       |
      | Claude Code |
      | Copilot     |

  # --- Where a session came from --------------------------------------------

  # pi records a parent only when a session was split off another one. It stores
  # the parent's file location, not the parent's identifier, so capture has to
  # open that file and read the identifier out of its first line. pi does not
  # distinguish its several ways of splitting, and we do not need it to: a
  # parent being present is what makes a session a branch.

  @unit
  Scenario: A session started fresh has no parent
    Given a pi session that was not split off another
    When the session is captured
    Then the session records no parent and is not marked a branch

  @unit
  Scenario: A session split off another records where it came from
    Given a pi session split off an earlier one
    When the session is captured
    Then the session records the earlier session as its parent and is marked a branch

  @unit
  Scenario: The parent is recorded as an identifier, and the parent's file location is not stored
    Given a pi session split off an earlier one, where pi stored the earlier session's file location
    When the session is captured
    Then the recorded parent is the earlier session's own identifier, and no file location is stored

  @unit
  Scenario: A parent whose file has been deleted leaves the parent blank
    Given a pi session split off an earlier one whose file the user has since deleted
    When the session is captured
    Then the session records no parent and is still marked a branch

  @unit
  Scenario: Resuming a session does not create a second one
    Given a pi session the user resumed twice, which pi appended to the same file each time
    When the session is captured after each run
    Then one session is recorded, not three

  # Keeping one session is not the same as keeping one copy of its turns. The
  # reader's memory of what it has already sent dies with the run, and the
  # server adds each turn it receives rather than replacing it, so a resumed
  # session that was offered from its first row again would bill every earlier
  # turn a second time.
  @unit
  Scenario: Resuming a session does not charge its earlier turns again
    Given a pi session whose turns an earlier run already recorded
    When the user resumes it, two more turns are added, and it is captured again
    Then only the two new turns are recorded

  # --- Only capturing what we launched, and only once -----------------------

  # What separates the two is each row's own clock, pi's rather than the
  # filesystem's, against the run's start time. The file's write time is only a
  # prefilter, and a deliberately loose one: it carries a one second grace
  # because a filesystem mtime can land before the stamp it is compared to. A
  # file the user last wrote in the second before launch is read; its rows are
  # then dropped individually. See the header of pi-capture.ts, which states
  # that mtime is not a sound question on its own.
  #
  # A second pi the user starts by hand during this run writes rows on the same
  # clock, so the time window alone captures it too.
  #
  # This is a choice we have not revisited, not a limit pi imposes. pi ships
  # --session-id, which sets the session id and the file name, so a launcher
  # can pick the id up front and later match on it exactly. It also ships
  # --name, which persists a launcher-supplied string as a session_info row,
  # and --session-dir, which isolates a launcher's sessions entirely. The
  # wrapper passes none of them, so capture falls back to a time window and
  # takes whatever else wrote in it. Replacing the window with an exact id is
  # the better design and is tracked as #8161; it is out of scope here because
  # it changes what capture is keyed on, not just how it is filtered.
  #
  # Given the time window we do use, over-capture is the deliberate side. The
  # alternative, tightening the file stamp to files created after the run
  # started, would drop every resumed session, because a resumed file already
  # existed. The header's cwd would not rescue it: the common collision is a
  # second terminal in the same project, where cwd matches, and the header is
  # written once at creation, so a session resumed from elsewhere still
  # reports its original directory and would be dropped too.
  # Both halves are asserted, never just the absence: a run that captured
  # nothing at all would satisfy the absence on its own.
  @unit
  Scenario: A pi session LangWatch did not launch is left alone
    Given a pi session file the user produced by running pi directly, last written before this run started
    And a session this run launches itself
    When LangWatch runs
    Then the session the user produced is not captured
    And the session this run launched is captured

  # The langwatch CLI does not route pi through the gateway. That is a decision,
  # not a limit: PI_CODING_AGENT_DIR relocates pi's whole agent directory, and
  # both it and AZURE_OPENAI_BASE_URL were run against pi and moved its
  # endpoint. What pi ignores is only OPENAI_BASE_URL and ANTHROPIC_BASE_URL.
  # The CLI declines because PI_CODING_AGENT_DIR moves the user's sign-in and
  # settings along with the model list, and the CLI runs against the install
  # they use for everything else. The langy worker accepts that cost inside its
  # own sandbox. ADR-132 §Invariants. So pi is captured from the file whether or
  # not a key is present. Before this was measured, the scenario here asserted
  # the opposite, and the opposite is total silent data loss for every user who
  # holds a key. See ADR-132 revision v10.
  # A key is something a person has stored on their own machine, not a setting
  # their organisation holds, and it changes nothing here, so neither of these
  # may rest only on what the launcher says: both runs print the same sentence.
  # What each has to show is what a wrongly routed run would have done instead.
  # Holding a key, that is handing the key to pi, which would send it to the
  # model provider it dials directly. Holding none, it is creating one, which a
  # run put on the wrong path does without being asked.
  @unit
  Scenario: A virtual key does not switch pi to server-side capture
    Given a user who has a virtual key stored on their machine, launching pi
    When the session runs
    Then pi's calls are not routed through LangWatch, and the key is never handed to pi
    And reading the file is started
    And the launcher says the session is read from its file rather than routed through us

  @unit
  Scenario: A session with no virtual key is captured from the file
    Given a user who has no virtual key stored on their machine, launching pi
    When the session runs
    Then reading the file is started
    And no virtual key is created for the run
    And the launcher says the session is read from its file rather than routed through us

  # --- Launching it ---------------------------------------------------------

  # pi is refused today in both launch modes, as an unsupported tool. Removing
  # both refusals is part of this work.

  @unit
  Scenario Outline: pi is accepted as a tool that can be launched
    Given a user launching pi <mode>
    When the launch is prepared
    Then it is accepted rather than refused as an unsupported tool

    Examples:
      | mode                |
      | with a virtual key  |
      | without a virtual key |

  # Every other tool we launch is handed an endpoint and an ingest token so it
  # can export its own telemetry. pi exports nothing, so handing it those would
  # buy no capture and cost real exposure: the wrapper re-exports them into the
  # interactive shell, so anything else the developer runs in that session
  # inherits a live token and can post data to us under pi's name.

  @unit
  Scenario: The pi child process is handed no telemetry credentials
    Given a user launching pi without a virtual key
    When the launch is prepared
    Then pi's process is given no telemetry settings and no token

  @unit
  Scenario: A tool that ships no exporter cannot be instrumented
    Given a user asking to permanently wire up a tool that sends us nothing
    When the request is checked
    Then it is refused and the user is pointed at launching the tool instead

  @unit
  Scenario: The pi command runs but is not advertised yet
    Given a user who runs the pi command
    When the command list is also shown
    Then pi launches, and the pi command is not among the commands listed

  # --- Events, not traces ---------------------------------------------------

  @unit
  Scenario: Capture sends events and no spans
    Given a captured pi session
    When what capture sends is inspected
    Then at least one event was sent, and no spans were sent for pi

  # --- Never get in the way -------------------------------------------------

  @integration
  Scenario: Capture that cannot reach LangWatch does not disturb the coding session
    Given capture that cannot reach LangWatch
    When the user runs a pi session
    Then pi exits with its own exit code

  @integration
  Scenario: The command exits when pi exits
    Given a pi session being captured
    When pi exits
    Then the command exits too, rather than staying alive

  @unit
  Scenario: Launching pi through LangWatch leaves the machine as it found it, apart from LangWatch's own files
    Given a user running pi through LangWatch for the first time
    When the session finishes
    Then pi's own configuration, their shell start-up files, editor settings and agent guidance files are unchanged from before the run
    And no shell function is written for pi, as one is for other tools

  @unit
  Scenario: Capture leaves pi's session file exactly as pi wrote it
    Given a pi session being captured
    When the session finishes
    Then the session file's contents are unchanged from what pi wrote

  # --- Governance -----------------------------------------------------------

  # Per-agent policy is no longer set on an admin page. It comes from the tool
  # tile an organisation configures. A tool the tile cannot name gets the
  # permissive default silently, which is the failure these guard.

  @unit
  Scenario: The tool tile offers pi
    Given an organisation configuring which coding tools it governs
    When the list of tools the tile offers is read
    Then pi is among them

  # Both facts are named outright rather than as "not the fall-back". A card
  # reading a blank maker is as useless to the person holding the renewal as one
  # reading "Vendor not recorded", and only the exact strings tell the two apart.
  #
  # Earendil Works rather than "Open source", which is what opencode carries: pi
  # has a company a customer can put on a renewal, and the licence is a separate
  # fact from who publishes it. Consumption because pi runs on a key the person
  # supplies — there is no pi plan and no pi seat to count.
  @unit
  Scenario: The catalog names Earendil Works as pi's maker and bills it on use
    Given an organisation that registered pi from the tool tile
    When its catalog card is read
    Then the card names Earendil Works as pi's maker
    And the card says pi is billed on what it consumed

  @unit
  Scenario: A pi policy chosen in the tile is accepted when saved
    Given an organisation that picked pi in the tool tile and set a policy for it
    When the policy is saved
    Then it is stored rather than rejected

  @integration
  Scenario: A pi policy set in the tile is the one the launcher applies
    Given an organisation that picked pi in the tool tile and set a policy stricter than the default
    When a user launches pi
    Then the launcher applies that policy rather than the permissive default

  @unit
  Scenario: The two copies of the governed tool list name the same tools
    Given the copy of the governed tool list held by the launcher and the copy held by the server
    When both are read
    Then they name the same tools
