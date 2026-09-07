Feature: Voice agents v1: test an ElevenLabs agent from the app
  As a team that runs a voice agent on ElevenLabs
  I want to talk to it from the browser and have a simulated caller phone it
  So that every call lands as a run with transcript, audio and verdict

  # @see https://github.com/langwatch/langwatch/issues/7947

  Background:
    Given a project
    And an ElevenLabs Conversational AI agent "Support line" reachable by agent id

  # ---------------------------------------------------------------------------
  # Golden paths (E2E)
  # ---------------------------------------------------------------------------

  # AC1, AC2, AC3, AC4, AC6, AC10, AC13, AC16, AC19, AC24
  @e2e @unimplemented
  Scenario: First voice agent, from a blank project to a judged run
    Given a project with no ElevenLabs key configured
    When I open New agent and choose "Voice agent"
    And I name it "Support line", choose "ElevenLabs agent" under Reached via and paste the agent id
    Then the drawer says there is no ElevenLabs key in this project and offers "Add key"
    When I follow "Add key", paste the key under Model providers, save and go back
    Then the drawer keeps my draft and the Credentials line names the ElevenLabs provider row
    When I save the agent
    Then "Support line" appears in the agents list with the mic icon
    When I press "Talk to it", allow the microphone, say "I want to cancel my order" and hang up after the agent answers
    Then the panel shows the transcript, a Play control and a link to a run with caller "You"
    When I open New scenario, write the situation, the persona and the criteria for "Angry cancellation"
    And under Agent I pick "Support line", keep the project default caller voice and save
    And I press "Run"
    Then the run console fills turn by turn with caller audio and agent audio
    And when the call ends the run shows a verdict, one chip per criterion and caller "Simulated"

  # AC5, AC10, AC13
  @e2e @unimplemented
  Scenario: Talk to an existing agent from its drawer
    Given the voice agent "Support line" with a configured ElevenLabs key
    When I open its drawer, press "Talk to it" and allow the microphone
    Then the panel shows Connecting, then a running timer and a live two-speaker transcript
    When I say "I want to cancel my order" and the agent answers
    And I press "Hang up"
    Then the panel shows the transcript, a Play control and a link to the run
    And that run has caller "You", per-turn audio and the transcript

  # AC19, AC24
  @e2e @unimplemented
  Scenario: A simulated caller phones the agent and the run is judged
    Given the voice agent "Support line"
    And a scenario "Angry cancellation" with a persona, criteria and the default caller voice
    When I open the run dialog, pick "Support line" and press "Run"
    Then the run console fills turn by turn with caller audio and agent audio
    And when the call ends the run shows a verdict and one chip per criterion
    And the run shows caller "Simulated"

  # AC23, AC24
  @e2e
  Scenario: Call it myself against a scenario and be scored on its criteria
    Given the voice agent "Support line"
    And a scenario "Angry cancellation" with criteria
    When I open the run dialog, pick "Support line" and press "Call it myself"
    And I talk to the agent and hang up
    Then the run is scored against the "Angry cancellation" criteria
    And the run shows caller "You"

  # AC20
  @e2e @unimplemented
  Scenario: The scenario's caller voice is what the simulated caller speaks with
    Given a scenario "Angry cancellation" whose Caller voice is set to a specific voice with Interrupts at 20 percent
    When I run it against "Support line"
    Then the caller turns in the run console are spoken in that voice
    And the run settings of the finished run record that voice and the interrupt setting

  # AC28
  @e2e @unimplemented
  Scenario: A voice run stops at the maximum call duration
    Given the project's maximum voice call duration is 2 minutes
    When a simulated caller run against "Support line" is still talking at 2 minutes
    Then the call is ended by LangWatch
    And the run is judged on what was said and marked as cut at the limit

  # ---------------------------------------------------------------------------
  # Drawer and panel states (integration)
  # ---------------------------------------------------------------------------

  # AC7
  @integration
  Scenario: Talk to it is disabled until the agent id is filled
    Given an unsaved voice agent drawer with a key but no agent id yet
    When the drawer is drawn
    Then "Talk to it" is disabled with the tooltip "Enter the agent id first"
    When the agent id is filled in
    Then "Talk to it" is enabled without saving the agent first

  # AC7
  @integration
  Scenario: Talk to it is disabled when the project has no ElevenLabs key
    Given the saved voice agent "Support line" and a project with no ElevenLabs key
    When the drawer is drawn
    Then "Talk to it" is disabled with the tooltip "Add an ElevenLabs key first"

  # AC8
  @integration
  Scenario: Session mint returns only the signed URL, the conversation id and the max duration
    Given the AI Gateway mints an ElevenLabs signed URL for "Support line"
    When "Talk to it" is pressed
    Then the browser receives only the signed URL, the conversation id and the max duration in seconds
    And the response body carries no ElevenLabs API key

  # AC9
  @integration
  Scenario: A mint failure shows a retry panel and starts no run
    Given the AI Gateway returns an error when minting the session for "Support line"
    When "Talk to it" is pressed
    Then the panel shows "Could not start the call: <gateway message>" and a Retry button
    And no run is created

  # AC11
  @integration
  Scenario: The panel shows the consent and guardrails notice before the call connects
    Given "Talk to it" was just pressed and the call has not connected
    When the panel is drawn
    Then it shows "This call is recorded and sent to ElevenLabs. LangWatch gateway guardrails do not apply to this session."

  # AC12
  @integration
  Scenario: The timer turns red in the final 60 seconds and the call ends at the limit
    Given the project's maximum voice call duration is 90 seconds
    And a live call panel connected to "Support line"
    When 60 seconds or fewer remain
    Then the timer is shown in red
    When the 90 second limit elapses
    Then the panel reaches the post-call view with no Hang up click

  # AC15
  @integration
  Scenario: Recording unavailable leaves the transcript without a Play control or an error
    Given ElevenLabs returns no audio for the finished conversation
    When the post-call fetch runs
    Then the panel and the run show the transcript with no Play control and no error notice

  # AC15
  @integration
  Scenario: A recording fetch failure keeps the live transcript and shows a fetch-failed notice
    Given the ElevenLabs post-call fetch fails after hang-up
    When the fetch failure is handled
    Then the run holds the transcript captured live during the call with no Play control
    And the panel shows "Recording could not be fetched from ElevenLabs" instead of a generic error

  # AC14
  @integration
  Scenario: Hanging up twice, a mid-call reload and a late webhook each produce exactly one run
    Given a live call against "Support line" with a known conversation id
    When Hang up is pressed twice, the page is reloaded during the call, and the ElevenLabs post-call webhook arrives after the poller already wrote the run
    Then exactly one run exists for that conversation id after each action

  # AC27
  @integration
  Scenario: Microphone access denied shows a retry notice and starts no run
    Given "Talk to it" was pressed
    When the browser denies microphone access
    Then the panel shows "Microphone access was denied. Allow it in the browser and try again." with a Retry button
    And the panel does not stay on "Connecting"
    And no run is created for that attempt

  # ---------------------------------------------------------------------------
  # Scenario wiring and run surfaces (integration)
  # ---------------------------------------------------------------------------

  # AC17
  @integration
  Scenario: The Caller voice group lives under Customize scenario and applies only to voice runs
    Given a scenario editor for any scenario
    When the editor is drawn
    Then the "Customize scenario" section is collapsed
    When "Customize scenario" is expanded
    Then a collapsed "Caller voice" group offers Voice, Interrupts and Effects with their defaults
    When Voice, Interrupts and Effects are set and the scenario is saved and reloaded
    Then the reloaded editor shows the saved values
    And the caller voice only takes effect when the scenario is later run against a voice target

  # AC18
  @integration
  Scenario: The Voice picker lists only audio and realtime models the project has credentials for
    Given the project has credentials for one audio-tagged model and one chat-only model
    When the Voice picker of the Caller voice group is opened
    Then only the audio-tagged model is offered
    And a chat model picker elsewhere in the project is unchanged

  # AC21
  @integration
  Scenario: A run with a wrong agent id or a removed key fails without hanging the pool
    Given a voice agent with an invalid agent id, and a second voice agent whose project key was removed
    When a run is started against each
    Then each run finishes as failed within 60 seconds with "ElevenLabs rejected the connection: <reason>" or "No ElevenLabs key in this project"
    When a text run is started afterwards
    Then it completes normally

  # AC22
  @integration
  Scenario: At most the concurrency cap of voice runs execute at once
    Given the project's voice run concurrency cap is 2
    When 4 voice runs are started at once
    Then 2 runs execute and 2 runs wait in the queue with status "Queued"

  # AC22
  @integration
  Scenario: A voice run that fails before its call starts frees its concurrency slot
    Given the project's voice run concurrency cap is reached
    When a queued voice run fails before its call starts, such as a prefetch error or a cancellation
    Then its concurrency slot is released
    And the next queued voice run for the project starts

  # AC24
  @integration
  Scenario: The results table shows a Caller column for both simulated and panel runs
    Given a batch containing a pool run against "Support line" and a panel run against "Support line"
    When the results table is drawn
    Then the Caller column reads "Simulated" for the pool run and "You" for the panel run

  # ---------------------------------------------------------------------------
  # Regression and credential handling (integration)
  # ---------------------------------------------------------------------------

  # AC25
  @integration
  Scenario: Existing HTTP, Code and Workflow agent flows are unchanged
    Given an HTTP agent, a Code agent and a Workflow agent already registered
    When each is created, edited and run as before
    Then their drawers and run dialogs behave exactly as they did before voice agents shipped
    And a scenario with an HTTP target runs with no Caller voice group and no "Call it myself" button

  # AC26
  @integration
  Scenario: No ElevenLabs key leaves the server through any response or log
    Given a project with an ElevenLabs key configured
    When a session is minted, a call is completed and a simulated run is completed
    Then no tRPC response, client bundle or log line contains the ElevenLabs API key

  # ---------------------------------------------------------------------------
  # Pure logic (unit)
  # ---------------------------------------------------------------------------

  # AC2
  @unit
  Scenario: A voice agent config with a trimmed agent id is valid
    Given a voice agent config with transport "elevenlabs_convai" and a 1-128 character agent id
    When the config is validated
    Then it is accepted

  # AC2
  @unit
  Scenario: A voice agent config with an empty agent id is rejected
    Given a voice agent config whose agent id is empty after trimming
    When the config is validated
    Then it is rejected

  # AC2
  @unit
  Scenario: A voice agent config with an unrecognised transport is rejected
    Given a voice agent config whose transport is not a known member of the transport union
    When the config is validated
    Then it is rejected

  # AC18
  @unit
  Scenario: The voice model filter predicate keeps only credentialed audio or realtime models
    Given a model tagged audio with project credentials, a model tagged realtime with project credentials, and a chat model with credentials
    When the voice model filter predicate runs over the list
    Then only the audio-tagged and realtime-tagged models pass

  # AC14
  @unit
  Scenario: The idempotency key is derived from the conversation id
    Given two ingestion attempts carrying the same conversation id and one attempt carrying a different conversation id
    When the idempotency key is derived for each
    Then the two same-conversation attempts produce the same key
    And the different conversation produces a different key

  # AC12
  @unit
  Scenario: The countdown math flags the final 60 seconds of the call
    Given a call duration limit and an elapsed time 60 seconds or fewer before the limit
    When the remaining time is computed
    Then it is flagged as the red countdown window
    Given an elapsed time more than 60 seconds before the limit
    When the remaining time is computed
    Then it is not flagged
