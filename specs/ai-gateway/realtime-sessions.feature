Feature: Brokered realtime voice sessions on the AI Gateway
  As a platform team running voice agents on customer provider keys
  I want the gateway to mint the vendor's own short-lived session credential
  So that voice spend lands on a virtual key, under a budget, with a cap on how
  many calls one key may run at once
  And so the media socket still runs client to vendor, with no relay hop on the
  turn latency

  # ADR-097. The gateway holds no socket. It checks the budget, resolves the
  # customer's stored provider credential, calls the vendor's own mint
  # endpoint, and hands back what the vendor answered plus a LangWatch session
  # id. One session is one spend record: admitted at the mint, confirmed when
  # the vendor reports the call.

  Background:
    Given the gateway is running with a control plane
    And a virtual key "vk-lw-test" bound to an organization with an OpenAI API key configured
    And the organization also has an ElevenLabs API key configured

  # ============================================================
  Rule: The mint endpoints mirror the vendor's own paths

    @integration
    Scenario: An ElevenLabs signed URL is minted for a hosted agent
      When the client GETs /v1/convai/conversation/get-signed-url with an agent_id
      Then the response is 200 carrying the vendor's signed_url verbatim
      And the response carries an X-LangWatch-Session-Id header
      And the media socket the URL opens goes from the client to the vendor

    @unit
    Scenario: A signed-URL request without an agent_id is refused
      When the client GETs /v1/convai/conversation/get-signed-url with no agent_id
      Then the response is 400 bad_request
      And no provider is called
      # A signed URL is bound to one agent; there is no default to fall back on.

    @unit
    Scenario: An OpenAI ephemeral client secret is minted from the caller's session body
      When the client POSTs /v1/realtime/client_secrets with a session declaration
      Then the body reaches OpenAI as the caller wrote it
      And OpenAI's own ephemeral secret comes back verbatim, with the LangWatch session id added beside it

    @unit
    Scenario: The resolved model is written back into the session body
      Given the virtual key aliases "voice" to "openai/gpt-realtime"
      When the client POSTs /v1/realtime/client_secrets naming model "voice"
      Then the body sent upstream names "gpt-realtime" at session.model
      And every other field of the caller's session declaration is unchanged

    @unit
    Scenario: A session lifetime outside the vendor's own bounds is clamped
      When the client asks for an expires_after.seconds of 86400
      Then the value sent upstream is 7200
      # OpenAI refuses anything over two hours, so forwarding the caller's
      # number would turn a long session into a 400.

    @unit
    Scenario: An ElevenLabs SDK reaches the mint with its own auth header
      When the client presents the virtual key in an xi-api-key header
      Then the key resolves and the mint proceeds
      # Pointing the SDK at the gateway base URL is the whole change.

  # ============================================================
  Rule: The endpoint decides the vendor, never the model string

    @unit
    Scenario: The signed-URL route is served only by an ElevenLabs credential
      Given a virtual key whose only credential is OpenAI
      When the client GETs /v1/convai/conversation/get-signed-url
      Then the response is 400 model_provider_not_bound naming the elevenlabs slot
      And no provider is called

    @unit
    Scenario: The client-secret route is served only by an OpenAI credential
      Given a virtual key whose only credential is ElevenLabs
      When the client POSTs /v1/realtime/client_secrets
      Then the response is 400 model_provider_not_bound naming the openai slot

    @unit
    Scenario: A mint never falls back to a second credential
      Given the virtual key holds two ElevenLabs credentials and the first one fails
      When the client GETs /v1/convai/conversation/get-signed-url
      Then the vendor's error is returned
      And the second credential is not tried
      # A signed URL is bound to one agent inside one workspace, so the second
      # key would sign for an agent that does not exist there and the caller
      # would get a working-looking URL that fails at the socket.

    @unit
    Scenario: A residency base URL on the credential is honoured
      Given the ElevenLabs provider is configured with a regional base URL
      When a signed URL is minted
      Then the mint call goes to that host

  # ============================================================
  Rule: A session is admitted at the mint and confirmed by the vendor's report

    @integration
    Scenario: A mint admits a spend record and does not confirm it
      When a session is minted
      Then a spend record exists for the gateway request id with status admitted
      And no confirmation is emitted by the mint
      # Confirming here would close the record at zero dollars before the call
      # has started, and leave the settlement sweeper nothing to settle.

    @integration
    Scenario: A refused mint is still visible as a spend record
      When a mint is refused
      Then the spend record for that request is failed with the refusal's own error type

    @integration
    Scenario: A post-call report closes the session and confirms its spend
      Given a session was minted and a conversation was held
      When the vendor's post-call report arrives
      Then the session row is CLOSED and carries the vendor's own cost payload
      And a confirmation is sent carrying audio_ms equal to the reported call duration in milliseconds
      # The confirmation is what moves the budget: the spend pipeline debits
      # every budget the key is under from that one event.

    @unit
    Scenario: A session with no report is left for the settlement sweeper
      Given a session was minted and no report ever arrived
      Then the mint emitted no confirmation of its own
      # The spend record stays admitted until the settlement grace expires,
      # and settles as cost unknown, flagged for reconciliation.

    @integration
    Scenario: A report arriving after the session closed still confirms it
      Given a session that has already left the open state
      When the vendor's report arrives afterwards
      Then a confirmation is still sent with the reported quantities
      # The fold makes a confirmation supersede a settled record, so a late
      # report replaces the unknown cost with the real one.

    @unit
    Scenario: Audio tokens are taken out of the text totals before rating
      When a client posts an OpenAI realtime usage report carrying an audio split
      Then the audio counts are reported disjoint from the text counts
      # Audio tokens price around eight times text tokens, so charging both the
      # total and the audio on top bills the audio portion twice.

  # ============================================================
  Rule: One key may only hold so many voice calls open at once

    @integration
    Scenario: A mint past the cap is refused and books nothing
      Given the virtual key allows one open realtime session
      And one session is already open
      When the client mints another
      Then the reservation is refused for the session limit, naming the count and the limit
      And no second session is booked

    @unit
    Scenario: A refused mint is refused with 429
      Then the realtime_session_limit code answers HTTP 429
      # A slot frees when a call ends, so a client should back off and retry
      # rather than treat the refusal as terminal.

    @integration
    Scenario: Closing a session frees its slot
      Given the key is at its cap
      When one session closes
      Then the next mint is admitted

    @integration
    Scenario: A session that outlived the longest possible call stops holding a slot
      Given a session has been open longer than the vendor's maximum call length
      When the key's next mint counts its open sessions
      Then the stale session is EXPIRED and does not count
      # An OpenAI socket never signals that it closed, so without this a key
      # ratchets down one slot at a time until it can mint nothing.

    @integration
    Scenario: Two mints racing on one key cannot both take the last slot
      Given the key allows one open session and two mints arrive at once
      Then exactly one is admitted and the other is refused

  # ============================================================
  Rule: A session nobody recorded is never minted

    @unit
    Scenario: The mint fails closed when the session cannot be recorded
      Given the control plane cannot record the session
      When the client mints
      Then the mint is refused with realtime_registry_unavailable, which answers HTTP 503
      And no vendor credential is minted
      # Deliberately against the budget fail-open rule: an unrecorded session
      # is voice no ledger will ever see and a cap the next mint cannot count
      # against.

    @unit
    Scenario: A failed mint releases its booking
      Given the session was booked and the vendor rejected the mint
      Then the booking is closed as FAILED
      And it stops counting against the key's cap

    @unit
    Scenario: Guardrails are skipped for a mint, and the caller is told
      Given the virtual key has guardrails attached
      When the client mints a session
      Then the guardrails do not run
      And the response carries X-LangWatch-Guardrails-Not-Applied: realtime_session
      # The body is a session declaration, not a prompt, and the conversation
      # never passes through the gateway. Running them would report protection
      # that cannot exist.

  # ============================================================
  Rule: A post-call report is matched exactly, or not at all

    @unit
    Scenario: A delivery signed with the wrong secret is refused
      When a post-call delivery arrives with an invalid ElevenLabs-Signature
      Then the signature check fails and nothing is confirmed
      # The route answers 401. A provider id with no webhook secret stored
      # answers 404 instead, the same as an id that does not exist, so the
      # ids are not probeable.

    @unit
    Scenario: A replayed delivery outside the signature tolerance is refused
      When a delivery's own signed timestamp is hours old
      Then the signature check fails

    @integration
    Scenario: The conversation id recorded at the mint is the join key
      Given the mint asked for the conversation id and recorded it
      When the post-call report arrives
      Then it matches that session directly

    @integration
    Scenario: Two candidate sessions is a miss, not a guess
      Given a report carries no conversation id we recorded
      And two sessions for that credential are open in the window
      Then no session is matched
      # Charging a call to the wrong session is a wrong bill that looks right.
      # An unmatched call settles visibly as cost unknown instead.

    @integration
    Scenario: A report never matches another organization's session
      Given a report is signed for one organization's credential
      When it names a conversation id belonging to another organization
      Then no session is matched

  # ============================================================
  Rule: What the broker deliberately does not do

    @unimplemented
    Scenario: A session is terminated mid-call when its budget runs out
      # Admission at session start is the decision (ADR-097). The gateway does
      # not hold the socket, so it cannot end a call in progress. Overshoot is
      # bounded by session length, and the docs say so in those words.

    @unimplemented
    Scenario: The session's tool policy is enforced from the virtual key
      # The tools of a hosted agent live at the vendor, and an OpenAI session
      # declares its own. Enforcing either needs the relay, which stays behind
      # its four gates.
