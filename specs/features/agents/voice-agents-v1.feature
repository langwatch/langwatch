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
  # Proven: run scenariorun_0002mz2FOX0FmRBTfPCRLLK23czeT after #8037 (no automated e2e binding yet)
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
    Then the panel shows the transcript and a Play control, and no run exists for that conversation id
    When I open New scenario, write the situation, the persona and the criteria for "Angry cancellation"
    And under Agent I pick "Support line", keep the project default caller voice and save
    And I press "Run"
    Then the run console fills turn by turn with caller audio and agent audio
    And when the call ends the run shows a verdict, one chip per criterion and caller "Simulated"

  # AC5, AC10, AC13
  # Proven: PR #8040 (c0996a92a7) (no automated e2e binding yet)
  @e2e @unimplemented
  Scenario: Talk to an existing agent from its drawer
    Given the voice agent "Support line" with a configured ElevenLabs key
    When I open its drawer, press "Talk to it" and allow the microphone
    Then the panel shows Connecting, then a running timer and a live two-speaker transcript
    When I say "I want to cancel my order" and the agent answers
    And I press "Hang up"
    Then the panel shows the transcript and a Play control, and no run exists for that conversation id
    And a trace exists for that conversation id with per-turn audio and the transcript

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
  @e2e @unimplemented
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
  @unit @regression
  Scenario: Hanging up twice produces exactly one run
    Given a live "Call it myself" call against a scenario with a known conversation id
    When Hang up is pressed twice for that conversation id
    Then exactly one run exists for that conversation id

  # #8020 AC1
  @unit @regression
  Scenario: Hanging up twice on a drawer call records traces and writes no run
    Given a live drawer "Talk to it" call with a known conversation id and no scenario in scope
    When Hang up is pressed twice for that conversation id
    Then no run is ever written for that conversation id
    And the call's traces are recorded, deduped by their deterministic ids

  # AC27
  @integration
  Scenario: Microphone access denied shows a retry notice and starts no run
    Given "Talk to it" was pressed
    When the browser denies microphone access
    Then the panel shows "Microphone access was denied. Allow it in the browser and try again." with a Retry button
    And the panel does not stay on "Connecting"
    And no run is created for that attempt

  @integration
  Scenario: A page-level microphone block is named, not reported as a denial
    Given "Talk to it" was pressed
    And the page's Permissions-Policy does not allow the microphone
    When the panel checks the microphone
    Then the panel shows "This page is not allowed to use the microphone. Check the Permissions-Policy header on the LangWatch host or reverse proxy, then reload." with a Retry button
    And the browser is never asked for the microphone
    And no run is created for that attempt

  @unit
  Scenario: The app's own headers allow the microphone and the ElevenLabs socket
    Given a production response from the LangWatch app
    Then its Permissions-Policy allows the microphone for the app's own origin
    And its Content-Security-Policy connect-src admits https://api.elevenlabs.io and wss://api.elevenlabs.io

  @unit @regression
  Scenario: The app's own headers allow the ElevenLabs audio worklets
    Given a production response from the LangWatch app
    And the ElevenLabs browser client registers its audio worklets from a blob: URL
    Then its Content-Security-Policy script-src admits blob:
    And "Talk to it" does not fail with "Failed to load the rawAudioProcessor worklet module"

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

  # AC17
  @integration
  Scenario: The caller voice is also offered in the Agent Testing scenario editor
    Given the Agent Testing scenario editor for any scenario
    When "Customize scenario" is expanded
    Then a "Caller voice" chip is offered alongside parameters, turns and models
    When the "Caller voice" chip is clicked
    Then the block offers Voice, Interrupts and Effects
    When a stored scenario carries a caller voice
    Then the editor opens with the Caller voice block already showing its values
    When the caller voice block is removed
    Then the draft's caller voice clears back to the project default

  # AC18
  @integration
  Scenario: The Voice picker lists the OpenAI caller voices when the project has an OpenAI provider
    Given the project has an enabled OpenAI provider
    When the Voice picker of the Caller voice group is opened
    Then the OpenAI caller voices are offered, each labelled by its capitalised name
    And a project with no OpenAI provider shows the add-a-provider state instead

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
  # Session binding and audio ownership (integration)
  # ---------------------------------------------------------------------------

  # AC13
  @integration
  Scenario: An unauthenticated Talk to it request is refused
    Given a request to mint a voice session with no logged-in user
    When the request is handled
    Then it is refused as unauthenticated and no session is minted

  # AC13
  @integration
  Scenario: A Talk to it request for another project is refused
    Given a logged-in user without permission on the requested project
    When a voice session is minted for that project
    Then it is refused as forbidden and no session is minted

  # AC13
  @integration
  Scenario: A session mint without a provider key is refused with the key-missing code
    Given the requested project has no ElevenLabs key
    When a voice session is minted
    Then it is refused with the key-missing code and no session is minted

  # AC13
  @integration
  Scenario: A finish with an invalid or expired session token is refused
    Given a finish request whose session token fails signature or expiry checks
    When the finish is handled
    Then it is refused with the session-invalid code and no run is written

  # AC13
  @integration
  Scenario: A finish whose conversation ran against another agent is refused
    Given a finish request whose fetched conversation names a different vendor agent than the token
    When the finish is handled
    Then it is refused with the conversation-mismatch code and no run is written

  # AC13
  @integration
  Scenario: A session minted for one project cannot finish a call in another project
    Given a session token minted for project A
    When a finish request is sent to project B with that token
    Then it is refused with the session-invalid code and no run is written

  # AC15
  @integration
  Scenario: The recording proxy refuses a conversation that is neither a run nor a saved voice agent's call in the project
    Given a recording is requested for a conversation with no run in the authorised project
    And the provider record's agent does not match any saved voice agent in the project
    When the proxy is handled
    Then it answers "Recording unavailable" without streaming the audio

  # AC13
  @integration
  Scenario: The finished call plays its recording through the same-origin proxy url
    Given a finished call whose provider record has audio
    When the post-call view is drawn
    Then the panel plays the recording through the same-origin proxy url

  # ---------------------------------------------------------------------------
  # Voice run preparation (unit)
  # ---------------------------------------------------------------------------

  # AC19
  @unit
  Scenario: A voice target resolves its ElevenLabs credential from the project provider
    Given a voice agent and a project with an enabled ElevenLabs provider
    When the run data is prefetched for that voice target
    Then the prepared voice target carries the resolved credential

  # AC19
  @unit
  Scenario: A voice target with no ElevenLabs provider resolves a null credential
    Given a voice agent and a project with no ElevenLabs provider
    When the run data is prefetched for that voice target
    Then the prepared voice target carries a null credential

  # AC20
  @unit
  Scenario: A voice target carries the scenario caller voice to the child
    Given a scenario with a caller voice and a voice target
    When the run data is prefetched
    Then the scenario's caller voice is carried on the prepared data

  # AC19, AC20
  @unit
  Scenario: A voice target carries the caller OpenAI key to the child
    Given a voice agent and a project with an enabled OpenAI provider
    When the run data is prefetched for that voice target
    Then the prepared voice data carries the project's OpenAI key as caller env

  # AC19, AC20
  @unit
  Scenario: The caller voice keys reach the child env only for a voice target
    Given a prepared voice run with caller env keys and a prepared non-voice run
    When each child environment is built
    Then the voice child receives the caller OpenAI key and the non-voice child does not

  # AC19, AC21
  @unit
  Scenario: A voice run with no OpenAI key fails early with a named message
    Given a prepared voice run whose project has no OpenAI key
    When the voice adapter is created for the run
    Then it fails before connecting with the add-an-OpenAI-key message

  # AC19
  @unit
  Scenario: A voice agent is refused by the agent-test path
    Given a voice target on the agent-test path
    When the run data is prefetched
    Then it is refused because voice agents are tested by talking to them or by running a scenario

  # AC18
  @unit
  Scenario: The enabled ElevenLabs provider row is resolved for a project
    Given a project whose accessible providers include an enabled ElevenLabs row
    When the ElevenLabs provider for the project is resolved
    Then the enabled ElevenLabs row is returned

  # AC18
  @unit
  Scenario: A project with no enabled ElevenLabs provider resolves none
    Given a project whose accessible providers include only disabled or non-ElevenLabs rows
    When the ElevenLabs provider for the project is resolved
    Then no provider is returned

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
  Scenario: The caller voice value validates the provider slash voice shape
    Given a caller voice value
    When the caller voice config is validated
    Then a well-formed "provider/voice" string is accepted and a value of the wrong shape is rejected

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

  # ---------------------------------------------------------------------------
  # AC29 — Voice is behind the release_voice_agents_enabled flag
  # ---------------------------------------------------------------------------

  # AC29
  @integration
  Scenario: The Voice Agent option is hidden while the project's flag is off
    Given a project with the release_voice_agents_enabled flag off
    When the agent type selector drawer is drawn
    Then the Voice Agent option is not offered

  # AC29
  @integration
  Scenario: Talk to it appears on a voice agent's card menu while the flag is on
    Given a project with the release_voice_agents_enabled flag on
    When a voice agent's card menu is opened
    Then Talk to it is offered

  # AC29
  @integration
  Scenario: Talk to it is hidden on a voice agent's card menu while the flag is off
    Given a project with the release_voice_agents_enabled flag off
    When a voice agent's card menu is opened
    Then Talk to it is not offered

  # AC29
  @integration
  Scenario: The Caller voice group is hidden while the project's flag is off
    Given a project with the release_voice_agents_enabled flag off
    When Customize scenario is opened on the scenario form
    Then the Caller voice group is not offered

  # AC29
  @integration
  Scenario: The Caller voice chip is hidden while the project's flag is off
    Given a project with the release_voice_agents_enabled flag off
    When the Agent Testing scenario editor is drawn
    Then the Caller voice chip is not offered among the customize chips

  # AC29
  @integration
  Scenario: The voice agent editor shows a disabled message when opened with the flag off
    Given a project with the release_voice_agents_enabled flag off
    When the voice agent editor drawer is drawn
    Then it shows "Voice agents are not enabled for this project" instead of the editor

  # AC29
  @unit
  Scenario: Creating a voice agent is refused while the flag is off
    Given a project with the release_voice_agents_enabled flag off
    When a create request names type "voice"
    Then it is refused as forbidden and no agent is created

  # AC29
  @unit
  Scenario: Updating an agent's type to voice is refused while the flag is off
    Given a project with the release_voice_agents_enabled flag off
    When an update request names type "voice"
    Then it is refused as forbidden and no agent is updated

  # AC29
  @unit
  Scenario: Updating a non-voice field does not check the voice flag
    Given a project with the release_voice_agents_enabled flag off
    When an update request names no type
    Then the voice flag is never checked

  # AC29
  @integration
  Scenario: A mint request is refused with a 404 while the voice flag is off
    Given a project with the release_voice_agents_enabled flag off
    When a voice session mint is requested
    Then it is refused with the voice_agents_disabled code, as a 404

  # AC29
  @integration
  Scenario: A finish request is refused with a 404 while the voice flag is off
    Given a project with the release_voice_agents_enabled flag off
    When a voice session finish is requested
    Then it is refused with the voice_agents_disabled code, as a 404

  # AC29
  @integration
  Scenario: The audio proxy is refused with a 404 while the voice flag is off
    Given a project with the release_voice_agents_enabled flag off
    When the recording audio proxy is requested
    Then it is refused with the voice_agents_disabled code, as a 404

  # AC29
  @unit
  Scenario: A run against a voice target is refused while the project's flag is off
    Given a suite run whose target is a voice agent and the project's flag is off
    When the run is prepared
    Then it is refused before anything is resolved or queued

  # ---------------------------------------------------------------------------
  # Empty transcript and Call it myself scenario scoping (#8019)
  # ---------------------------------------------------------------------------

  # #8019 AC1
  @unit @regression
  Scenario: An unfinished provider record keeps the live transcript
    Given ElevenLabs answers the conversation read with status "processing" right after hang-up
    And the browser captured at least one turn during the call
    When the call is finished
    Then the run holds the turns the browser captured
    And the run source is "browser"

  # #8019 AC2
  @unit @regression
  Scenario: A finished provider record with turns is written as the provider transcript
    Given ElevenLabs answers the conversation read with status "done" and a non-empty transcript
    When the call is finished
    Then the run holds the provider turns
    And the run source is "provider"

  # #8019 AC3
  @unit @regression
  Scenario: A finished provider record with no turns keeps the live transcript
    Given ElevenLabs answers the conversation read with status "done" but no turns
    And the browser captured at least one turn during the call
    When the call is finished
    Then the run holds the turns the browser captured
    And the run source is "browser"

  # #8019 AC4
  @unit @regression
  Scenario: A failed provider record keeps the live transcript without a fetch-failed notice
    Given ElevenLabs answers the conversation read with status "failed"
    And the browser captured at least one turn during the call
    When the call is finished
    Then the run holds the turns the browser captured
    And the run source is "browser"
    And the finish does not report the fetch as failed

  # #8019 AC5
  @unit @regression
  Scenario: The provider record is read only once the status is done
    Given ElevenLabs answers the conversation read with a status
    When the record is read
    Then a "done" status returns the record
    And a "processing" status, a "failed" status or a 404 returns nothing

  # #8019 AC8
  @unit @regression
  Scenario: A single-scenario suite scores a Call it myself run under that scenario
    Given a run dialog opened on a suite that holds exactly one scenario
    When the voice-call target is resolved
    Then it carries that scenario id so the call is scored under it

  # #8019 AC9
  @unit @regression
  Scenario: Call it myself is offered only when one scenario is in scope
    Given a run dialog opened on a subject with more than one scenario
    When the dialog footer renders
    Then it offers no "Call it myself" action

  # #8019 AC10
  @unit @regression
  Scenario: Finish refuses an unresolvable scenario and writes nothing
    Given a finish names a scenario that no longer resolves to a set
    When the call is finished
    Then it is refused with the scenario_not_found code
    And no run is written

  # ---------------------------------------------------------------------------
  # A retried hang-up completes a half-written run (#7973)
  # ---------------------------------------------------------------------------

  # 7973 AC1
  @unit @regression
  Scenario: A retried hang-up leaves a terminal run untouched
    Given a run for the session already reached a terminal status
    When the call is finished again
    Then no run is written
    And the existing run id and agent id are returned unchanged

  # 7973 AC2, AC3, AC4
  @unit @regression
  Scenario: A retried hang-up completes a half-written run
    Given a run for the session is still in progress after a failed write
    When the call is finished again
    Then the run is re-driven under the same run id
    And its finish is emitted exactly once
    And the message ids are identical to the first attempt

  # 7973 AC5
  @e2e @unimplemented
  Scenario: A retried hang-up completes an in-progress run end to end
    Given a call left a run in progress
    When the browser retries the finish
    Then the run completes with no duplicate messages

  # 7973 AC6
  @unit @regression
  Scenario: A re-driven finish keeps the first attempt's metadata
    Given a run for the session was started twice with different metadata
    When a snapshot and the finish are folded onto it
    Then the run keeps the first attempt's metadata
    And it reaches the finished status with the snapshot's messages

  # ---------------------------------------------------------------------------
  # Talk to it authorization and the cutoff marker (#8021)
  # ---------------------------------------------------------------------------

  # 8021 AC1
  @integration @regression
  Scenario: Talk to it without agent-management rights and no saved row is refused
    Given a member with scenario rights but not agent-management rights
    When they mint a Talk to it session without a saved agent row
    Then the mint is refused for the evaluations:manage permission
    And no session is minted

  # 8021 AC2
  @integration @regression
  Scenario: Finishing an unsaved session without agent-management rights is refused
    Given a member with scenario rights but not agent-management rights
    And a session token that carries no saved agent id
    When they finish the call with a name
    Then the finish is refused
    And no agent is created

  # 8021 AC3
  @integration @regression
  Scenario: Talk to it against a saved agent needs only scenario rights
    Given a member with scenario rights but not agent-management rights
    When they mint and finish against a saved agent row
    Then neither is refused for the evaluations:manage permission

  # 8021 AC4
  @integration @regression
  Scenario: Talk to it with agent-management rights mints an unsaved session
    Given a member with scenario rights and agent-management rights
    When they mint a Talk to it session without a saved agent row
    Then the session is minted so the agent is created on finish

  # 8021 AC5
  @unit @regression
  Scenario: A simulated voice run cut at the call limit records the cutoff marker
    Given a succeeded simulated voice run whose child was cut at the call limit
    When the processor handles the result
    Then the cutoff marker is recorded on the run
    And the run read back has metadata.langwatch.isCutAtLimit true

  # 8021 AC6
  @unit @regression
  Scenario: A simulated voice run that finished normally records no cutoff marker
    Given a succeeded simulated voice run whose child was not cut at the limit
    When the processor handles the result
    Then no cutoff event is dispatched

  # 8021 AC8
  @unit @regression
  Scenario: The cutoff marker folded twice sets the flag once
    Given the cutoff marker is recorded twice for the same run
    When the run state is folded
    Then the flag is set once and the metadata is unchanged on the second fold

  # 8021 AC7
  @integration @regression
  Scenario: A voice run stops at the maximum call duration and is marked as cut at the limit
    Given a run whose metadata marks it cut at the call limit
    When the run header renders
    Then it shows the "Cut at the call limit" marker

  # ---------------------------------------------------------------------------
  # Every browser voice call writes a trace (3a)
  # ---------------------------------------------------------------------------

  # 3a AC1
  @unit @regression
  Scenario: A finished browser call writes one trace per exchange and every message links to its exchange's trace
    Given a finished call whose turns group into exchanges
    When the call is finished
    Then one trace is recorded per exchange before the run is written
    And every message carries the trace id of the exchange it belongs to
    And a trace recording failure does not block the run write

  # 3a AC2
  @unit @regression
  Scenario: A re-driven finish writes the same trace ids
    Given a half-written run is re-driven for the same conversation
    When the call is finished again
    Then the recomputed trace ids are identical to the first attempt

  # ---------------------------------------------------------------------------
  # A drawer call is not persisted as a run (#8020)
  # ---------------------------------------------------------------------------

  # #8020 AC1
  @unit @regression
  Scenario: A drawer Talk to it call writes no run
    Given a finish with no scenario id
    When the call is finished
    Then writeCallRun is never called
    And findExistingRun is never called
    And the call's traces are still recorded
    And the finish result carries no run id and no scenario set id

  # #8020 AC2
  @unit @regression
  Scenario: Call it myself still writes a run under its scenario after 8020
    Given a "Call it myself" finish naming a resolvable scenario id
    When the call is finished
    Then writeCallRun is called with that scenario and its set
    And the finish event names the scenario, so the run is judged

  # #8020 AC3
  @unit @regression
  Scenario: A drawer finish never mints a synthetic scenario id
    Given a finish with no scenario id
    When the call is finished
    Then writeCallRun is never called
    And no scenarioId of the form "voiceagent_<agentId>" is ever produced

  # #8020 decision 1
  @unit @regression
  Scenario: A retried drawer finish for an unsaved agent reuses the one agent row
    Given two drawer finishes for the same never-saved voice agent
    When each finish creates the voice agent row
    Then the identity key folds them onto the same row rather than creating a second

  # #8020 decision 2
  @unit @regression
  Scenario: The legacy voice-calls set is excluded from run listings
    Given a run-listing query is built
    When its set exclusion is applied
    Then the "voice-calls" set is excluded alongside the agent-test set
    And a run is still read by its own id

  # #8020 decision 5
  @unit @regression
  Scenario: A human caller's turns render as You, not User Simulator
    Given a scenario run whose caller kind is "human"
    When the conversation body renders a caller turn
    Then it reads "You" with a person icon, not "User Simulator" with a flask

  # #8020 regression: a drawer call writes no run, so its recording must be
  # authorized by matching the provider conversation to a saved voice agent.
  @unit @regression
  Scenario: A drawer call's recording still plays after hang-up
    Given a finished drawer call whose conversation ran against a voice agent saved in the project
    When the recording is requested and no run exists for that conversation id
    Then playback is authorized by matching the provider agent id to the saved voice agent row
    And the provider credential is returned only when the match holds
