Feature: An agent keeps a session value for one conversation
  As a person who points a scenario at an agent
  I want the value my agent returns for a conversation to come back on its next turn
  So that the agent keeps its own conversation state with no shared store of its own

  # ADR-128 gives every agent one per conversation memory value, `session`.
  # The platform holds it for the run in the scenario child's adapter layer,
  # keyed by thread id, and sends it back on the next turn of the same thread.
  # The store lives in the shared serialized adapter base, so a connected
  # agent, a code agent and an HTTP agent read and write it the same way.
  # The value is capped at the session size from
  # platform/app/src/server/connected-agents/constants.ts.

  Rule: The session store is shared by every adapter and scoped to the run

    @unit
    Scenario: A thread has no session before its first turn answers
      Given an adapter that has taken no turn
      When the adapter reads the session of a thread
      Then it reads nothing

    @unit
    Scenario: A stored session is read back for the same thread only
      Given an adapter that stored a session for thread "a"
      When the adapter reads the session of thread "a" and of thread "b"
      Then thread "a" reads the stored value
      And thread "b" reads nothing

    @unit
    Scenario: A turn that returns no session leaves the held value unchanged
      Given an adapter that stored a session for a thread
      When a later turn of that thread returns no session
      Then the thread still reads the stored value

    @unit
    Scenario: A session above the cap is refused with a typed error
      Given an agent that returns a session above the session cap
      When the adapter stores it
      Then the turn fails with the code "agent_payload_too_large"
      And the error names the session size and the cap
      And the thread keeps the value it held before

    @unit
    Scenario: A refused session reads as a named run error
      Given a run whose agent returned a session above the cap
      When the run's failure is classified
      Then the run error carries the code "agent_payload_too_large"
      And the drawer shows a title, a message and a hint for it

  Rule: A code agent returns a session beside its reply and reads it on the next turn

    @unit
    Scenario: A code agent that returns a session receives it on the next turn
      Given a code agent with an input mapped to the scenario session
      And the code answered the first turn of a thread with a session value
      When the next turn of the same thread runs
      Then the code receives that value as the mapped input, untouched

    @unit
    Scenario: A code agent receives no session on the first turn of a thread
      Given a code agent with an input mapped to the scenario session
      When the first turn of a thread runs
      Then the code receives null as the mapped input

    @unit
    Scenario: Two threads of one code agent run do not share a session
      Given a code agent that answered thread "a" with a session
      When thread "b" of the same run takes its first turn
      Then the code receives null as the mapped input

    @unit
    Scenario: A code agent session above the cap fails the turn
      Given a code agent that returns a session above the session cap
      When the turn runs
      Then the turn fails with the code "agent_payload_too_large"

    @unit
    Scenario: A code agent input named session maps to the scenario session
      Given a code agent with an input named "session" and no saved mappings
      When the best match mappings are computed
      Then "session" maps to the scenario source "session"

    @integration
    Scenario: The session a code node returns beside its declared output reaches the run
      Given a code node that returns a session key beside its declared output
      When the workflow runs through the engine
      Then the node state carries the session key with the value the code returned
      And a non-string session sent as an entry input reaches the code as the same value

  Rule: An HTTP agent reads a session from the response and renders it on the next turn

    @unit
    Scenario: An HTTP agent receives the session it returned in the url, the headers and the body
      Given an HTTP agent whose session path matches a value in the response
      And the url, a header and the body template read "session"
      When the next turn of the same thread runs
      Then the url carries the value
      And the header carries the value
      And the body carries the value

    @unit
    Scenario: An HTTP agent renders an empty session on the first turn
      Given an HTTP agent whose body template reads "session"
      When the first turn of a thread runs
      Then the body renders "session" as an empty string

    @unit
    Scenario: A response with no match at the session path leaves the held value unchanged
      Given an HTTP agent that holds a session for a thread
      When a response of that thread has nothing at the session path
      Then the next turn still carries the held value

    @unit
    Scenario: Two threads of one HTTP agent run do not share a session
      Given an HTTP agent that answered thread "a" with a session
      When thread "b" of the same run takes its first turn
      Then the body renders "session" as an empty string

    @unit
    Scenario: An HTTP agent session above the cap fails the turn
      Given an HTTP agent whose session path matches a value above the session cap
      When the turn runs
      Then the turn fails with the code "agent_payload_too_large"

    @unit
    Scenario: A structured session renders as raw JSON in the body
      Given an HTTP agent whose session path matches an object in the response
      When the next turn of the same thread renders the body template
      Then "session" renders as the object's JSON, not as an escaped string

    @integration
    Scenario: The HTTP agent editor offers a session path
      Given a new HTTP agent editor drawer is open
      When the editor renders
      Then a "Session path" field is visible beside the output path

    @integration
    Scenario: The scenario mappings offer the session as a source
      Given a ScenarioInputMappingSection for a code agent
      When the section renders
      Then a row exists for "session"
