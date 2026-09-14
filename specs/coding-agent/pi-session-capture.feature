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

  @unit @unimplemented
  Scenario: A captured pi session shows the whole conversation in order
    Given a pi session with two user prompts, one tool call and two assistant replies
    When the session is captured
    Then all five appear in the transcript, in the order pi wrote them

  @unit @unimplemented
  Scenario: The session cost counts assistant turns, work inside tools, and summarised stretches
    Given a pi session with an assistant turn costing 10, work inside a tool costing 3, and a summarised stretch costing 2
    When the session is captured
    Then the session's cost is 15

  @unit @unimplemented
  Scenario: A turn pi charged nothing for is recorded as zero
    Given a pi session with an assistant turn that ended in an error and carries a cost of zero
    When the session is captured
    Then that turn's cost is recorded as zero

  @unit @unimplemented
  Scenario: A turn carrying no cost at all is left blank rather than counted as zero
    Given a pi session with an assistant turn that carries no cost field
    When the session is captured
    Then that turn's cost is left blank

  @unit @unimplemented
  Scenario: Measurements pi never reports are left blank rather than shown as zero
    Given a captured pi session
    When the session's measurements are read
    Then lines changed, commits and pull requests are blank rather than zero

  # --- Reading a file that is still being written ---------------------------

  @unit @unimplemented
  Scenario: Turns appended after a read are picked up by the next one
    Given a pi session file holding three turns
    When the session is captured, two more turns are appended, and it is captured again
    Then all five turns are recorded

  @unit @unimplemented
  Scenario: The same turn is not recorded twice
    Given a pi session whose turns have already been captured
    When the session is captured again
    Then each turn still appears once

  # pi copies the parent's row identifiers into the child when it splits a
  # session, so two files can hold rows with identical identifiers. Removing
  # duplicates by row identifier alone would silently swallow the child's
  # inherited history.

  @unit @unimplemented
  Scenario: Two sessions sharing row identifiers are kept apart
    Given a pi session split off another, where the child's rows carry the same identifiers as the parent's
    When both sessions are captured
    Then each session keeps its own full set of turns

  @unit @unimplemented
  Scenario: A session that stopped without shutting down cleanly keeps the turns pi had written
    Given a pi session with three turns on disk that stopped without shutting down cleanly
    When the session is captured
    Then those three turns are recorded

  @unit @unimplemented
  Scenario: A session abandoned before pi wrote anything records nothing and reports no error
    Given a pi session the user quit before the first assistant reply, for which pi wrote no file
    When capture runs
    Then no session is recorded and no error is raised

  @unit @unimplemented
  Scenario Outline: A session kept somewhere other than the default place is still found
    Given a user who set pi's session directory <how>
    When the session is captured
    Then the session is read from that directory

    Examples:
      | how                    |
      | with a command flag    |
      | with a variable in the environment |
      | in pi's settings file  |

  # --- Naming the agent, not the provider -----------------------------------

  @unit @unimplemented
  Scenario: The record names pi even though another provider answered
    Given a pi session answered by Anthropic models, where the rows name anthropic as the provider
    When the session is captured
    Then the record names pi as the agent, and no scope or service name contains anthropic

  # --- Not stealing other agents' sessions ----------------------------------

  # The identifier picks an agent by looking for its name inside the incoming
  # signal's scope or service, first match wins. The letters "pi" appear inside
  # both "anthropic" and "copilot", so a match rule of just those letters would
  # claim sessions belonging to other agents.

  @unit @unimplemented
  Scenario: pi's match rule does not fire on a scope or service that merely contains its letters
    Given pi's match rule, tested on its own with the ordering removed
    When it is offered a signal scoped to com.anthropic.claude_code.events and one whose service is copilot
    Then it claims neither

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: A session started fresh has no parent
    Given a pi session that was not split off another
    When the session is captured
    Then the session records no parent and is not marked a branch

  @unit @unimplemented
  Scenario: A session split off another records where it came from
    Given a pi session split off an earlier one
    When the session is captured
    Then the session records the earlier session as its parent and is marked a branch

  @unit @unimplemented
  Scenario: The parent is recorded as an identifier, and the parent's file location is not stored
    Given a pi session split off an earlier one, where pi stored the earlier session's file location
    When the session is captured
    Then the recorded parent is the earlier session's own identifier, and no file location is stored

  @unit @unimplemented
  Scenario: A parent whose file has been deleted leaves the parent blank
    Given a pi session split off an earlier one whose file the user has since deleted
    When the session is captured
    Then the session records no parent and is still marked a branch

  @unit @unimplemented
  Scenario: Resuming a session does not create a second one
    Given a pi session the user resumed twice, which pi appended to the same file each time
    When the session is captured after each run
    Then one session is recorded, not three

  # --- Only capturing what we launched, and only once -----------------------

  @unit @unimplemented
  Scenario: A pi session LangWatch did not launch is left alone
    Given a pi session file the user produced by running pi directly
    When LangWatch runs
    Then that session is not captured

  @unit @unimplemented
  Scenario: A session already captured on the server is not also captured from the file
    Given a pi session launched with a virtual key, where LangWatch captures it server-side
    When the session runs
    Then reading the file is never started

  @unit @unimplemented
  Scenario: A session with no virtual key is captured from the file
    Given a pi session launched without a virtual key
    When the session runs
    Then reading the file is started

  # --- Launching it ---------------------------------------------------------

  # pi is refused today in both launch modes, as an unsupported tool. Removing
  # both refusals is part of this work.

  @unit @unimplemented
  Scenario Outline: pi is accepted as a tool that can be launched
    Given a user launching pi <mode>
    When the launch is prepared
    Then it is accepted rather than refused as an unsupported tool

    Examples:
      | mode                |
      | with a virtual key  |
      | without a virtual key |

  @unit @unimplemented
  Scenario: The pi command runs but is not advertised yet
    Given a user who runs the pi command
    When the command list is also shown
    Then pi launches, and the pi command is not among the commands listed

  # --- Events, not traces ---------------------------------------------------

  @unit @unimplemented
  Scenario: Capture sends events and no spans
    Given a captured pi session
    When what capture sends is inspected
    Then at least one event was sent, and no spans were sent for pi

  # --- Never get in the way -------------------------------------------------

  @integration @unimplemented
  Scenario: Capture that cannot reach LangWatch does not disturb the coding session
    Given capture that cannot reach LangWatch
    When the user runs a pi session
    Then pi exits with its own exit code

  @integration @unimplemented
  Scenario: The command exits when pi exits
    Given a pi session being captured
    When pi exits
    Then the command exits too, rather than staying alive

  @unit @unimplemented
  Scenario: Launching pi through LangWatch leaves the user's machine unchanged
    Given a user running pi through LangWatch for the first time
    When the session finishes
    Then their shell start-up files, editor settings, agent plugins and guidance files are unchanged from before the run

  @unit @unimplemented
  Scenario: Capture leaves pi's session file exactly as pi wrote it
    Given a pi session being captured
    When the session finishes
    Then the session file's contents are unchanged from what pi wrote

  # --- Governance -----------------------------------------------------------

  # Per-agent policy is no longer set on an admin page. It comes from the tool
  # tile an organisation configures. A tool the tile cannot name gets the
  # permissive default silently, which is the failure these guard.

  @unit @unimplemented
  Scenario: The tool tile offers pi
    Given an organisation configuring which coding tools it governs
    When the list of tools the tile offers is read
    Then pi is among them

  @unit @unimplemented
  Scenario: A pi policy chosen in the tile is accepted when saved
    Given an organisation that picked pi in the tool tile and set a policy for it
    When the policy is saved
    Then it is stored rather than rejected

  @integration @unimplemented
  Scenario: A pi policy set in the tile is the one the launcher applies
    Given an organisation that picked pi in the tool tile and set a policy stricter than the default
    When a user launches pi
    Then the launcher applies that policy rather than the permissive default

  @unit @unimplemented
  Scenario: The two copies of the governed tool list name the same tools
    Given the copy of the governed tool list held by the launcher and the copy held by the server
    When both are read
    Then they name the same tools
