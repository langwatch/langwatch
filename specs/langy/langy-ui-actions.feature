# The agent driving the page the user has open, through typed UI actions.
#
# The channel: `langwatch ui call <kind> --payload '<json>'` (run by the agent
# inside its worker, authenticated with its per-conversation session key) hits
# POST /api/langy/ui/actions; the server validates the kind against the page's
# action manifest and the payload against that kind's schema, pins the action
# to the conversation's ACTIVE turn in Redis, and publishes it on that turn's
# live stream — the same live-only channel `navigate` rides. The open page
# claims the action (first claim wins), executes the page-registered handler
# against its own store, and reports the result back; the dispatching HTTP
# call returns that result to the CLI in the same request.
#
# Fallback behavior when no page is attached is specified separately in
# langy-ui-actions-fallback.feature.
Feature: Langy drives the open page through typed UI actions

  @unit
  Scenario: Agent invokes a workbench action and the attached browser applies it live
    Given the user has the workbench open and an agent turn is running
    When the agent runs langwatch ui call workbench.duplicateTarget
    Then the page claims the action and applies it through the workbench store

  @unit
  Scenario: The action's result returns to the agent within the same CLI call
    Given the page executed a dispatched action
    When the page reports the action's result
    Then the dispatching CLI call prints that result marked as executed in the browser

  @unit
  Scenario: A replayed stream entry executes the action only once
    Given the turn stream re-delivered an action entry after a reconnect
    When the page sees the same action id again
    Then it drops the replay before ever claiming

  @unit
  Scenario: With two tabs open, only the claiming tab executes
    Given two tabs show the same conversation
    When both react to the same dispatched action
    Then exactly one claim succeeds and the other tab drops silently

  @unit
  Scenario: A page without a handler leaves the action unclaimed
    Given the user's open page does not handle the dispatched kind
    When the action entry reaches it
    Then the page does not claim, leaving the server free to fall back

  @integration
  Scenario: With page control rolled back, the open page ignores dispatched actions
    Given agent-driven page control is switched off for my project
    When a dispatched action reaches my open page
    Then the page does not claim it, and nothing on the page changes

  @unit
  Scenario: With page control rolled back, the agent is never offered the ui commands
    Given agent-driven page control is switched off for my project
    When I send a turn from a page that accepts UI actions
    Then the turn does not tell the agent about the ui commands
    And the agent is still told what I am looking at

  @unit
  Scenario: An action outside a running turn is refused
    Given the conversation has no turn in flight
    When the agent dispatches an action
    Then the dispatch is refused with langy_ui_turn_inactive

  @unit
  Scenario: An unknown action kind is refused with langy_ui_action_unknown
    When the agent dispatches a kind no page manifest declares
    Then the dispatch is refused before anything reaches the stream

  @unit
  Scenario: A payload failing its schema is refused with langy_ui_payload_invalid
    When the agent dispatches a payload the action's schema rejects
    Then the dispatch is refused before anything reaches the stream

  @unit
  Scenario: A conversation id from another project is refused without confirming it exists
    When the agent names a conversation the session key's owner cannot see
    Then the dispatch answers not found, the same as for no conversation at all

  @unit
  Scenario: An unclaimed action deletes its pending record before answering
    Given nothing claimed the action inside the claim window
    When the dispatch gives up on the page
    Then the pending record is deleted first, so a late claim finds nothing

  @unit
  Scenario: A tab claiming as the dispatch gives up never double-executes
    Given nothing claimed the action inside the claim window
    When a tab claims while the dispatch hands the action to the backend
    Then the claim is refused and only the backend runs the action

  @unit
  Scenario: A claimed action that never completes times out without re-dispatching
    Given a page claimed the action and went silent
    When the action's execute budget runs out
    Then the agent gets langy_ui_timeout and the action is never re-dispatched

  @unit
  Scenario: A browser handler failure reaches the agent as langy_ui_handler_failed and the user as a toast
    Given the page's handler threw while applying the action
    When the page reports the failure
    Then the agent reads the handler's own error code and the user sees a toast
    And the refusal counts as the caller's fault, not the platform's

  @unit
  Scenario: An unexplained handler failure stays a platform fault
    Given the page's handler threw something that named no error code
    When the page reports the failure
    Then the agent reads the generic code and the failure counts as the platform's fault

  @unit
  Scenario: A result over the ceiling is measured by its encoded bytes
    Given the page reports a result of multi-byte characters
    When the result is over the size ceiling once encoded
    Then the agent gets result_too_large instead of the payload

  @unit
  Scenario: A claim naming another project or conversation is refused
    When a claim arrives for a project or conversation the dispatch did not name
    Then it is refused exactly like a claim for an unknown action

  # The conversation is asked for the current turn through a projection the
  # event log writes after the fact, while the page holds the turn id the send
  # returned to it. The two disagree for as long as the projection lags, and
  # while they do, every action the agent dispatched went to the backend with
  # the page open in front of the user. Which turn it is answers no security
  # question the project, the conversation and the session have not answered
  # already, so the claim no longer asks.
  @unit
  Scenario: The page claims while the conversation's recorded turn still lags
    Given the dispatch pinned the turn the conversation projection was showing
    When the page claims naming the turn its own send returned
    Then the claim succeeds and the page executes the action

  # A prompt draft is prose, and prose has apostrophes. Written into a shell
  # command as a single-quoted argument, the first one ends the quoting and the
  # rest of the prompt arrives as extra arguments, so the whole edit is lost.
  @unit
  Scenario: A payload too awkward to quote is read from a file or from stdin
    Given the action's payload carries a prompt with quotes and newlines in it
    When the caller passes the payload as a file, or as "-" for stdin
    Then the action is dispatched with exactly that payload

  @unit
  Scenario: Naming both a payload and a payload file is refused
    When the caller passes an inline payload and a payload file together
    Then the command refuses rather than picking one

  # The refusal is written for two readers: the agent, which acts on the code,
  # and the customer watching the panel, whose card parses the CLI's own failure
  # document. Writing the platform's REST envelope straight to stderr served
  # neither: the card could not read it, so it printed the whole thing, and the
  # customer got a wall of escaped JSON with the sentence buried in it.
  @unit
  Scenario: A refused action reaches the reader as a sentence, not the wire envelope
    Given the platform refuses an action and names the reason
    When the command reports the refusal
    Then it emits the CLI failure document carrying the platform's code and sentence

  @unit
  Scenario: Only the claiming user's session may complete an action
    Given one user's session claimed the action
    When a different session reports a completion
    Then the completion is dropped and the claimant's completion still lands

  @unit
  Scenario: The worker env carries the conversation id for the UI channel
    Given a worker is spawned for a conversation on either harness
    Then its environment names that conversation for the CLI's ui call

  @unit
  Scenario: A run scoped to a target and a row subset covers only those cells
    Given the agent dispatches workbench.run naming one target and a row subset
    When the run starts on either the browser or the backend path
    Then only that target's cells for those rows execute
    And neither filter is silently dropped in favor of the other

  Rule: An action the browser ran is saved before the agent is told it worked

    The agent reads a successful action as "the document now says this", and
    its next step is almost always a server-side one: start a run, read the
    state over REST, take a version. All of those read the SAVED document.

    Left on the ordinary autosave debounce, an agent's edit lived only in the
    tab that ran it. The run that followed computed from a document without
    that edit, wrote its results as a newer version, and the tab's pending save
    was then refused as out of date. From there the edit could never be saved
    at all, so the agent went on working against a page nothing else could see,
    and the customer read "Failed to save" over work they had just watched
    Langy do.

    A page can also reach a state where it cannot save at all: once the server
    holds a newer version, autosave stands down, because writing then would
    clobber it. Answering "done" from there is the same false success by
    another door, so the page refuses and names the state. The agent's remedy
    is the backend path, which writes the saved document directly.

    The write can also just fail: the connection drops, or the server rejects
    the document. Autosave reports that on the badge and keeps the edit for its
    next try, which is right for the customer watching the page. For the agent
    it read as a save that landed, so the page refuses that too, under its own
    code.

    @integration
    Scenario: A page that cannot save refuses the action instead of reporting success
      Given a page whose save was refused for a newer version
      When the agent dispatches a workbench action the browser handles
      Then the action is refused as out of date
      And the page is not changed

    @integration
    Scenario: A page that cannot save does not run the document it holds
      Given a page whose save was refused for a newer version
      When the agent dispatches a run
      Then the action is refused as out of date
      And no run is started

    @integration
    Scenario: A save that does not land is refused rather than reported as done
      Given a page whose save fails for a reason other than a newer version
      When the agent dispatches a workbench action the browser handles
      Then the action is refused as unsaved

    @integration
    Scenario: A save that does not land stops the run that would follow it
      Given a page whose save fails for a reason other than a newer version
      When the agent dispatches a run
      Then the action is refused as unsaved
      And no run is started

    @unit
    Scenario: A refused action tells the agent how to write anyway
      Given a page refused an action for a newer version
      When the agent reads the refusal
      Then it is told to apply the change to the saved evaluation instead

    @integration
    Scenario: An agent edit is on the server before the action reports success
      Given the agent dispatches a workbench action the browser handles
      When the handler has applied it to the page
      Then the action does not report success until the save is acknowledged
      And the version the page holds is the one the save returned

    @integration
    Scenario: A run waits for the page's own edits to be saved first
      Given the page holds an edit the agent has just made
      When the agent dispatches workbench.run
      Then the edit is saved before the run starts

    @integration
    Scenario: Two saves never overlap
      Given a save is already in flight
      When another save is asked for
      Then it waits for the first, so neither is refused for the other's version

  Rule: The customer can read what the agent asked the page to do

    The actions a page accepts are told apart by what they do, and most carry
    no display name of their own. The card that lists them numbered the rows
    instead, so the customer read "UI action 1, UI action 2" and learned
    nothing about any of them.

    @unit
    Scenario: The listed actions read as what they do
      Given listed actions that say what they do and carry no display name
      When Langy shows the list
      Then each row reads as what that action does
      And no row reads as a numbered noun

    @unit
    Scenario: A listed action with a display name keeps it
      Given listed actions that carry a display name as well
      When Langy shows the list
      Then each row reads as its display name
