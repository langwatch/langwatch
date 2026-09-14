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

  Everything below is unbuilt.

  # --- What the user gets ---------------------------------------------------

  @unit
  Scenario: A captured pi session shows the whole conversation in order
    Given a pi session with two user prompts, one tool call and two assistant replies
    When the session is captured
    Then all five appear in the transcript, in the order pi wrote them

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
  # The Then here is the directory we CHOOSE, not a session we read. Nothing
  # reads a session until the capture rungs land, and a scenario that claims a
  # read while no read exists passes on a promise. Reading is asserted by the
  # capture scenarios below, against a real session file.
  #
  # The default row is not decoration. It is the only row that holds when a
  # user has set nothing at all, which is every user on their first run, and it
  # was the one level that broke with every bound test still green.
  Scenario Outline: A session kept somewhere other than the default place is still found
    Given a user who set pi's session directory <how>
    When we work out where to look
    Then we look in that directory

    Examples:
      | how                                |
      | with a command flag                |
      | with a variable in the environment |
      | in pi's settings file              |
      | nowhere, so the usual place stands |

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

  # --- Only capturing what we launched, and only once -----------------------

  @unit
  Scenario: A pi session LangWatch did not launch is left alone
    Given a pi session file the user produced by running pi directly
    When LangWatch runs
    Then that session is not captured

  # pi ignores base-URL environment variables — every model's address is fixed in
  # its own build — so a virtual key can never route pi through LangWatch. It is
  # captured from the file whether or not a key is present. Before this was
  # measured, the scenario here asserted the opposite, and the opposite is total
  # silent data loss for every user who holds a key. See ADR-132 revision v10.
  # A key is something a person has stored on their own machine, not a setting
  # their organisation holds, and it changes nothing here — so neither of these
  # may rest on what the launcher says: both runs print the same sentence.
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
