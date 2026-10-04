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
    Scenario: A residency base URL on the credential is honored
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
      # The spend record stays admitted. A hosted-agent session settles as
      # cost unknown at the grace; a metered kind settles at its estimate.

    @integration
    Scenario: A report arriving after the session closed still confirms it
      Given a session that has already left the open state
      When the vendor's report arrives afterwards
      Then a confirmation is still sent with the reported quantities
      # The fold makes a confirmation supersede a settled record, so a late
      # report replaces the unknown cost with the real one.

    @integration
    Scenario: A settled session is written into the trace it was minted in
      Given a session was minted and a conversation was held
      When the vendor's post-call report arrives
      Then one span carrying the call's cost and quantities is written into the mint's trace
      # The media runs client to vendor, so the only span the gateway itself
      # can emit is the mint, and a mint costs nothing yet. Without this the
      # trace surface shows a call we billed at zero.

    @integration
    Scenario: A settlement delivered twice is written into the trace once
      Given a session that has already been closed and confirmed
      When the same settlement is delivered again
      Then no second span is written into the trace
      # A vendor may resend a webhook and a client may retry its report, so a
      # replay must supersede rather than add to what the trace already shows.

    @integration
    Scenario: Two settlements arriving together write one span
      Given an open session
      When two reports close it at the same moment
      Then the session carries the first report's close
      And the second writes no span into the trace
      # The second close waits on the first's row lock and re-reads the
      # status as the first left it. The same rule keeps a release or the
      # expiry sweep from moving a CLOSED session back to EXPIRED.

    @integration
    Scenario: A session minted without a trace writes no span
      Given a session was minted with no trace context
      When the vendor's post-call report arrives
      Then the spend is confirmed and no span is written
      # A trace id invented here would put a cost in the explorer under an id
      # nothing else references.

    @unit
    Scenario: Audio tokens are taken out of the text totals before rating
      When a client posts an OpenAI realtime usage report carrying an audio split
      Then the audio counts are reported disjoint from the text counts
      # Audio tokens price around eight times text tokens, so charging both the
      # total and the audio on top bills the audio portion twice.

  # ============================================================
  Rule: A call's usage reaches the key's budgets while it runs

    # Each usage report is its own spend record, named by the session and the
    # report. One growing record would debit a budget once, at the first
    # report, and never again. modules/gateway/specs/gateway-realtime-session-metering.feature
    # carries the per-report rules.

    Background:
      Given the virtual key has a blocking budget of 5 USD
      And its project has a blocking budget of 50 USD

    @integration
    Scenario: Each report debits every budget on the key's chain once
      Given an open realtime session on the key
      When two usage reports arrive, each for its own response
      Then the session's recorded cost grows by each report's cost
      And the key's budget and the project's budget are each debited once per report

    @integration
    Scenario: A report delivered twice debits its budgets once
      Given a usage report was recorded and debited
      When the same report is delivered again
      Then neither budget moves

    @integration
    Scenario: A breach of the key's budget is flagged in the usage response
      When a report takes the key's 5 USD budget to its limit
      Then the usage response says a budget is exceeded and names the key's budget
      And the budget check for the key's next request is a hard block
      # The gateway reads that same standing from the key's config bundle and
      # answers the next mint HTTP 402.

    @integration
    Scenario: A breach of the project's budget is flagged in the usage response
      Given the key's own budget has room and the project's 50 USD budget is nearly spent
      When a report takes the project's budget to its limit
      Then the usage response says a budget is exceeded and names the project's budget
      And the budget check for the key's next request is a hard block

    @integration
    Scenario: A report debits the bucket of the end user the mint named
      Given the key has a per-end-user budget of 2 USD
      And an open realtime session whose mint named an end user
      When a report takes that end user's bucket to its limit
      Then the debit lands in that end user's bucket of the per-end-user budget
      And the usage response says a budget is exceeded with scope attributed_user
      And the budget check for that end user's next request is a hard block
      And the budget check for another end user on the key is not blocked by it

    @integration
    Scenario: A session whose reports stopped is closed at what was recorded
      Given a client-metered session recorded reports and then went quiet past the open window
      When the reconciler runs
      Then the session is CLOSED with its recorded cost unchanged
      And its own spend record is confirmed, not left to settle as cost unknown

    @integration
    Scenario: An unreported realtime session settles at the estimate
      Given a client-metered realtime session past the open window that never reported
      When the reconciler runs
      Then an estimate is confirmed as the session's one report and debited to its budgets
      And the session is CLOSED for the reason that no usage report arrived

    @integration
    Scenario: A single report with no report key closes the session as it always did
      Given an open session with no reports
      When the client posts one usage report with no report key
      Then the whole usage is confirmed on the session's own record and the session is CLOSED

    @integration
    Scenario: A session total after keyed reports confirms only the remainder
      Given keyed reports recorded part of a session's usage
      When the client posts the session total with no report key
      Then only what the reports left out is confirmed on the session's own record
      And the trace's settlement span states the whole total once

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
    Scenario: A cap refusal answers HTTP 429
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
    Scenario: A mint whose conversation id cannot be recorded is refused
      Given the vendor minted a credential and reported its conversation id
      When the control plane cannot record that id against the booking
      Then the credential is not returned and the booking is released
      # The id is the only exact join key between a call and its spend
      # record, and the reconciler reads back only sessions that have one, so
      # handing the credential out anyway would bill a real conversation as
      # cost-unknown with no way to correct it. A retry costs the caller a
      # moment; the alternative costs the customer a call nobody can price.

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
  Rule: The vendor's webhook is received on the gateway and verified on the control plane

    # The URL a customer pastes into their own ElevenLabs dashboard is on the
    # gateway, so every customer-facing voice URL is on one host. The gateway
    # is public by design; the control plane is the admin surface, which a
    # self-hosted customer often keeps behind a VPN, and a webhook has to be
    # reachable from the vendor's network.

    @unit
    Scenario: The gateway relays a post-call delivery byte for byte
      Given a signed delivery arrives at the gateway webhook URL
      When the gateway forwards it to the control plane
      Then the raw body and the ElevenLabs-Signature header arrive unchanged
      # The HMAC covers the raw bytes, so any re-encoding on this hop would
      # fail every delivery. The gateway never parses the body.

    @unit
    Scenario: The gateway relays the control plane's own status
      Given the control plane answers a delivery
      Then the gateway returns that status unchanged
      # 404 keeps provider ids unprobeable and 401 is a real signature
      # failure, so neither may be reshaped into an acknowledgement.

    @unit
    Scenario: The webhook route carries no virtual key
      Given a delivery arrives with no Authorization header
      Then the gateway still relays it
      # The caller is the vendor, which has no virtual key. The delivery's
      # own HMAC is what authenticates it.

    @unit
    Scenario: A webhook the gateway cannot relay answers 502
      Given the control plane cannot be reached
      When a delivery arrives
      Then the gateway answers 502 rather than acknowledging it
      # An acknowledgement the gateway invented would report a landing that
      # never happened and hide a broken relay. The reconciler bills the call
      # either way, so the accurate answer costs nothing.

    @unit
    Scenario: A delivery past the relay cap answers 413
      Given a delivery larger than the relay size limit
      Then the gateway answers 413 and relays nothing
      # A body truncated at the cap would arrive well formed and fail its own
      # HMAC, which reads as a forgery rather than an oversized report.

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

    @unit
    Scenario: A usage report names the key that opened the session
      When a client posts a usage report
      Then the report carries the virtual key it arrived on, not only the project

    @integration
    Scenario: A usage report from another key in the same project is refused
      Given two virtual keys point at one trace project
      And one of them opened a voice session
      When the other posts a usage report against that session id
      Then the report is refused and the session stays OPEN
      # Keys in a project share its destination, and a session id is a
      # gateway request id the opener's own response header carries, so the
      # project alone cannot say whose spend record this is.

    @integration
    Scenario: A transcription report confirms the session it names
      Given an open session whose conversation id the mint recorded
      When a signed post_call_transcription report arrives carrying its duration
      Then the session is CLOSED and its spend is confirmed from that duration

    @integration
    Scenario: A delivery that cannot say what the call used confirms nothing
      Given an open session whose conversation id the mint recorded
      When a signed delivery arrives naming that conversation
      And it is an audio or call-initiation event, carries no type, or reports
        no duration or one that rounds to zero
      Then the delivery is acknowledged and the session stays OPEN
      # Every one of these names the conversation and would have matched.
      # Zero is a price, absence is not, and the fold never downgrades a
      # confirmation, so a session closed at zero can never be corrected. It
      # settles as cost-unknown on its grace instead, which is visible.
      # Acknowledged rather than refused because a retry is not guaranteed
      # and ten consecutive failures disable the webhook for every tenant.

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
  Rule: An ElevenLabs single-use token opens one speech or transcription socket

    # POST /v1/single-use-token/{token_type} mirrors the vendor's path. The
    # token opens a socket client to vendor, so the session is metered by what
    # the client reports and estimated when it reports nothing.

    @unit
    Scenario: An ElevenLabs single-use token is minted for each socket type
      When the client POSTs /v1/single-use-token/{token_type} for tts_websocket, ttd_websocket, realtime_scribe or batch_scribe
      Then the vendor's own path is called with the stored xi-api-key and no body
      And the vendor's body comes back verbatim with the LangWatch session id added beside it
      And the response carries an X-LangWatch-Session-Id header

    @unit
    Scenario: An unknown token type is refused
      When the client POSTs /v1/single-use-token/convai
      Then the response is 400 bad_request naming the four token types
      And nothing is booked

    @unit
    Scenario: The single-use token route is served only by an ElevenLabs credential
      Given a virtual key whose only credential is OpenAI
      When the client POSTs /v1/single-use-token/tts_websocket
      Then the response is 400 model_provider_not_bound
      And nothing is booked and no provider is called

    @unit
    Scenario: A token mint over budget is refused before anything is booked
      Given a blocking budget on the key is spent
      When the client POSTs /v1/single-use-token/tts_websocket
      Then the response is 402
      And nothing is booked and no provider is called

    @unit
    Scenario: A single-use token session is booked before the vendor is called
      When a token is minted
      Then the session is reserved before the vendor call
      And the booking carries the kind for its token type, client metering and an expiry fifteen minutes out
      And no conversation id is recorded
      # The vendor documents a fifteen minute token lifetime and answers no
      # expiry, so the gateway states it at the booking.

    @unit
    Scenario: A token mint the vendor rejects releases its booking
      Given the session was booked and the vendor answered an error
      Then the booking is closed as FAILED

    @unit
    Scenario: Each token type bills under the default model of its socket
      Then tts_websocket defaults to eleven_multilingual_v2 and books kind tts_socket
      And ttd_websocket defaults to eleven_v3_conversational and books kind tts_socket
      And realtime_scribe defaults to scribe_v2_realtime and books kind stt_socket
      And batch_scribe defaults to scribe_v2 and books kind stt_batch

    @unit
    Scenario: The model_id query parameter decides the token's model
      When the mint names model_id in its query string
      Then that model is resolved through the key's aliases and allowlist and booked
      And a default model outside the allowlist is refused as model_not_allowed
      # The vendor route carries no model, so the gateway reads it here.

    @unit
    Scenario: A token mint honors a residency base URL
      Given the ElevenLabs provider is configured with a regional base URL
      When a token is minted
      Then the mint call goes to that host

  # ============================================================
  Rule: A client reports usage as often as its socket states it

    # Each report is its own spend record, keyed by the vendor's id for it, so
    # budgets see a call while it runs and a resend is recorded once.

    @unit
    Scenario: An OpenAI mint books what metering needs
      When the client mints a session that declares an input transcription model
      Then the booking carries kind realtime, client metering and the transcription model as a catalog id
      And the credential expiry the vendor answered is recorded after the mint
      # The expiry only sizes the estimate for a session that never reports,
      # so a failure to record it does not refuse the mint.

    @unit
    Scenario: A mint books the end user its request named
      Given a mint request carrying an end user id
      When the session is booked
      Then the booking carries that end user id
      And a mint that names no end user books none

    @unit
    Scenario: A response.done event is recorded under its response id
      When the client posts a whole response.done event
      Then one report is sent keyed by response.id with source client
      And the session stays open

    @unit
    Scenario: A transcription event is priced as transcription
      When the client posts a conversation.item.input_audio_transcription.completed event
      Then the report is keyed by item_id and marked priced as transcription
      And a tokens usage keeps its audio and text counts disjoint
      And a duration usage is reported as audio milliseconds
      And usage with no item_id is refused

    @unit
    Scenario: A transcription event with no usage records nothing
      When the client posts a transcription event that carries no usage
      Then the response is 200 with status no_usage
      And the control plane is not called

    @unit
    Scenario: A batch of events is reported in order
      When the client posts several events under "events" with final set
      Then each event is reported in order under its own key
      And the close rides on the last report
      And the answer carries the last report's status and the sum of the costs

    @unit
    Scenario: A batch over the cap is refused
      When the client posts more than 100 events in one batch
      Then the response is 400 bad_request

    @unit
    Scenario: A usage total with no id closes the session
      When the client posts a bare usage object or one under "usage" with no id
      Then one report is sent with no key, which the control plane reads as the session total

    @unit
    Scenario: An ElevenLabs socket client reports characters and audio seconds
      When the client posts {"usage":{"characters":N}} or {"usage":{"audio_seconds":N}} with an id
      Then the report carries the characters or the audio duration under that id
      And "final": true closes the session after it is recorded

    @unit
    Scenario: A close ends the session with no usage
      When the client POSTs /v1/realtime/sessions/{id}/close with an empty body or a duration_ms
      Then one final report with no usage is sent

    @unit
    Scenario: A usage report answers its cost and the budget state
      When the control plane answers a report
      Then the response is 200 carrying session_id, status, cost_usd, session_cost_usd and budget
      And scope and budget_id are present only when the budget is exceeded
      # The gateway holds no socket, so the client is the only party that can
      # end a call whose budget is spent.

    @unit
    Scenario: A report against a session the key does not own answers 404
      When the control plane answers 404 for the session
      Then the usage and close routes answer 404

    @unit
    Scenario: A usage body that is not a report is refused
      When the client posts a body with no usage, an unknown event type, or a batch event with no id
      Then the response is 400 bad_request
      And the control plane is not called

    @unit
    Scenario: Cached audio tokens stay billed as audio
      When a response.done usage carries input_token_details.cached_tokens_details
      Then only the cached text tokens are reported as cache-read
      And the cached audio tokens stay inside the input audio count
      # The spend vocabulary has no cached-audio quantity, so cached audio
      # bills at the full audio rate (langwatch/langwatch#7048).

  # ============================================================
  Rule: A brokered call is set up by the gateway, with the provider key

    # The caller sends its WebRTC offer to the gateway. The gateway makes the
    # vendor's setup request, so it learns the call id. Media then runs client
    # to vendor and never passes through the gateway.

    @unit
    Scenario: A Live session is booked before the provider is called
      Given a virtual key with an OpenAI credential
      When the client posts a session and a WebRTC offer to /v1/live/sessions
      Then a supervision slot is taken, the session is booked, and only then is the provider called
      And the booking is of kind live, metered by the gateway, on the OpenAI credential

    @unit
    Scenario: A Live session is created with the provider key and answered verbatim
      When the gateway posts the session to the provider's /v1/live/sessions
      Then the request carries the provider key and the caller's body unchanged
      And the provider's status and body are returned, with langwatch.session_id added

    @unit
    Scenario: A Live answer is returned verbatim with the gateway session id
      When the provider answers 201 with a session id and an SDP answer
      Then the caller receives that status and body, and an X-LangWatch-Session-Id header
      And the provider's session id is recorded on the booking
      And the call is handed to the supervisor with that id and the credential

    @unit
    Scenario: A Live session the provider refuses is released
      When the provider answers the setup request with HTTP 400
      Then the caller receives the provider's own status and error
      And the booking is released and the supervision slot is given back

    @unit
    Scenario: A Live session cannot delegate to a model the key does not allow
      Given a virtual key that allows only some models
      When the session names a session.delegation.responses.model outside that list
      Then the request is refused as model_not_allowed
      And nothing is booked and the provider is not called

    @unit
    Scenario: A Live session over a transport other than WebRTC is refused
      When the client posts a session whose transport.type is not "webrtc", or with no offer
      Then the request is refused with HTTP 400 and nothing is booked

    @unit
    Scenario: A Realtime call is brokered from the multipart form
      When the client posts multipart parts "sdp" and "session" to /v1/realtime/calls
      Then the booking is of kind realtime, metered by the gateway, with the session's transcription model
      And the SDP answer is returned byte for byte with the provider's Location and the session header
      And the call id from the Location is recorded on the booking

    @unit
    Scenario: A Realtime call is brokered from a raw SDP offer
      When the client posts application/sdp to /v1/realtime/calls?model=openai/gpt-realtime
      Then the provider receives a session of type realtime naming the resolved model
      And the SDP answer and Location are returned

    @unit
    Scenario: A Realtime call is created as multipart and its Location is returned
      When the gateway posts the offer and the session to the provider's /v1/realtime/calls
      Then the request is multipart with an application/sdp part and an application/json part
      And it carries the provider key
      And the call id is read from the Location header

    @unit
    Scenario: A call the vendor did not name is not handed out
      When the provider creates a call but its answer carries no id
      Then the request fails as a provider error
      # A call with no id can be neither metered nor ended.

    @unit
    Scenario: A key at its open session cap gets no brokered call
      Given the virtual key is at its open session limit
      When the client posts a brokered call
      Then the request answers HTTP 429 and the provider is not called
      And the supervision slot is given back

    @unit
    Scenario: A budget that is already spent refuses a brokered call
      Given the key's budget is exhausted
      When the client posts a brokered call
      Then the request answers HTTP 402 and nothing is booked

    @unit
    Scenario: A brokered call that cannot be recorded is ended at the provider
      When the provider created the call but its id could not be stored on the booking
      Then the gateway hangs the call up at the provider and releases the booking
      And the caller does not receive the SDP answer

  # ============================================================
  Rule: The gateway meters a brokered call from its own server-side socket

    # The supervisor attaches to the vendor's event socket for the call with
    # the provider key. It sends what the vendor states to the control plane,
    # one keyed report at a time.

    @unit
    Scenario: The server-side socket carries the provider key
      When the supervisor attaches to a brokered call
      Then the socket request carries the provider key and never the virtual key

    @unit
    Scenario: Cumulative Live seconds are reported as deltas
      Given the provider states 12 and then 15 cumulative seconds
      Then the reports carry 12 and 3 seconds, keyed u-12 and u-15
      # The vendor's number is a running total. Summing snapshots would bill
      # the same seconds twice.

    @unit
    Scenario: Live duration reports are throttled
      Given several usage updates arrive inside one reporting interval
      Then one report covers them, and the remainder is sent when the session closes

    @unit
    Scenario: A closed Live session sends its final delta and closes
      When the provider sends session.closed with a last cumulative total
      Then the remaining seconds are reported and the report closes the session

    @unit
    Scenario: A delegated response is reported once under its own model
      Given a Live session that delegates responses to another model
      When that response completes, and the event is delivered twice
      Then one report is sent, keyed by the response id and priced as openai/<model>

    @unit
    Scenario: Reflected audio is dropped without stopping the meter
      Given the socket carries large audio frames between usage events
      Then the audio is discarded without being parsed and the usage is still reported

    @unit
    Scenario: Each Realtime response is one report
      Given three response.done events on a Realtime call
      Then three reports are sent, each keyed by its response id
      And each splits text, audio and cached tokens

    @unit
    Scenario: Realtime transcription usage is reported in both its forms
      Given one transcription event with token usage and one with a duration
      Then each is reported, priced as transcription, keyed by its item id
      And an event with no usage reports nothing

    @unit
    Scenario: A vendor that closes the socket closes the session
      When the provider closes the server-side socket of a Realtime call with a close frame
      Then a final report with no usage closes the session
      And the hangup route is not called

    @unit
    Scenario: A failed usage report is retried and counted once
      Given the control plane refuses two reports
      Then the same delta is sent again under the same key and recorded once

    @unit
    Scenario: Realtime reports wait in a queue while the control plane is down
      Given the control plane is unreachable while three responses complete
      Then the three reports are sent in order once it answers, each once

    @unit
    Scenario: A quiet Live session is kept from being taken for a lost one
      Given a Live session whose total has not moved for the keep-alive interval
      Then a keyed report with no usage is sent
      # The control plane closes a gateway-metered Live session that goes
      # silent, which a call on hold would otherwise look like.

    @unit
    Scenario: A dropped server-side socket is re-attached
      When the socket drops without a close frame
      Then the supervisor attaches again and the meter carries on from the last total

  # ============================================================
  Rule: The gateway ends a brokered call without the client's help

    @unit
    Scenario: A Live call over budget is asked to close
      When a usage receipt says a budget is exceeded
      Then the supervisor sends session.close on the socket
      And the session ends with reason budget_exceeded

    @unit
    Scenario: A Live close that is not confirmed falls back to the hangup route
      When the provider does not confirm the close in time
      Then the supervisor calls the session's hangup route

    @unit
    Scenario: A Realtime call over budget is hung up
      When the receipt of the second response says a budget is exceeded
      Then the supervisor calls /v1/realtime/calls/{call_id}/hangup with the provider key
      And a final report closes the session

    @unit
    Scenario: A call the gateway's own budget check blocks is ended
      When the gateway's periodic budget check blocks the key
      Then the call is hung up with reason budget_exceeded

    @unit
    Scenario: A call whose key is revoked is ended
      When the virtual key is revoked, disabled or deleted during the call
      Then the call is hung up with reason key_revoked within the key refresh interval

    @unit
    Scenario: A session the control plane already closed is ended
      When a usage report is answered as already closed
      Then the call is hung up and no further report is sent

    @unit
    Scenario: A call whose server-side socket cannot be re-attached is ended
      When the socket cannot be re-attached inside the re-attach window
      Then the call is hung up with reason sideband_lost and the session closes at what was recorded

    @unit
    Scenario: A Live session that never attaches is ended and charged its creation time
      When the socket of a Live session never attaches
      Then the call is hung up and one final report charges 15 seconds
      # The vendor bills session creation, so an unmetered Live session is
      # not free.

  # ============================================================
  Rule: A gateway instance bounds and drains the calls it supervises

    @unit
    Scenario: A full gateway refuses a new call before booking it
      Given the instance supervises its maximum number of calls
      When the client posts a brokered call
      Then the request answers HTTP 503 with Retry-After
      And nothing is booked and the provider is not called

    @unit
    Scenario: A draining gateway refuses a new call
      Given the instance is shutting down
      When the client posts a brokered call
      Then the request answers HTTP 503 with Retry-After

    @unit
    Scenario: Draining ends the remaining calls and sends their final reports
      Given calls are still running when the drain budget ends
      Then each is ended with reason drain and its final report is sent before the process exits

  # ============================================================
  Rule: A WebSocket-transport client is relayed, frame by frame

    # The vendor's WebSocket needs the real API key, so a client on that
    # transport cannot dial the vendor itself. It upgrades on the gateway with
    # its virtual key; the gateway dials the vendor with the provider key and
    # carries frames both ways. A relayed socket is a supervised session like
    # a brokered call: booked before the vendor is dialed, metered by the
    # gateway, ended on budget or revoke, drained on shutdown.

    @unit
    Scenario: A WebSocket upgrade passes through every layer of the gateway
      Given the router with its metrics, tracing and access-log layers
      When a client upgrades on GET /v1/realtime
      Then the upgrade answers 101 and frames flow both ways
      And the session is booked with metering gateway

    @unit
    Scenario: The relay swaps the virtual key for the provider key
      Given a browser presents its virtual key as the subprotocol openai-insecure-api-key.<key>
      When it upgrades on GET /v1/realtime?model=<alias>
      Then the vendor handshake carries the provider key and the resolved model
      And the virtual key is in no header, query parameter or subprotocol of it
      And the client is answered the realtime subprotocol, never the key one

    @unit
    Scenario: The vendor socket of a relay carries the provider key
      When the relay dials the vendor
      Then the handshake carries the provider key on the credential's own host

    @unit
    Scenario: The relay carries every frame unchanged in both directions
      When text and binary frames are sent each way, one of them larger than a megabyte
      Then each arrives with the same type and the same bytes

    @unit
    Scenario: A Live socket's first frame decides the model
      When the client upgrades on GET /v1/live/sessions and sends session.start
      Then session.model is resolved and written back into that one frame
      And the vendor socket is opened with no query string
      And every later frame is relayed untouched

    @unit
    Scenario: A Live socket cannot delegate to a model the key does not allow
      When session.start names a session or delegated model outside the allowlist
      Then the client gets an error frame and close 1008
      And nothing is booked and the provider is not dialed

    @unit
    Scenario: An ElevenLabs socket takes the virtual key in a header or the query
      When a client upgrades on a speech, dialogue or transcription socket route
      Then the key parameters are removed from the query and the rest is forwarded as written
      And the vendor handshake carries the provider key as xi-api-key
      And key fields in the client's first frame are stripped before it is forwarded

    @unit
    Scenario: A socket for a model the key does not allow is refused before the upgrade
      When the model of a Realtime or ElevenLabs socket is outside the allowlist
      Then the request answers HTTP 400 and no socket is opened

    @unit
    Scenario: A key with no credential for the socket's vendor is refused
      Given a key whose only credential is Azure OpenAI
      When the client upgrades on a Realtime or ElevenLabs socket route
      Then the request answers HTTP 400 and the provider is not dialed
      # The Realtime socket is served by an OpenAI credential only: no Azure
      # realtime deployment URL exists in the gateway to dial.

    @unit
    Scenario: A budget that is already spent refuses the upgrade
      Given the key's budget is exhausted
      When the client upgrades
      Then the request answers HTTP 402 and nothing is booked

    @unit
    Scenario: A full or draining gateway refuses an upgrade with 503
      Given the instance supervises its maximum number of calls, or is shutting down
      When the client upgrades
      Then the request answers HTTP 503 with Retry-After and nothing is booked

    @unit
    Scenario: A vendor that refuses the socket releases the booking
      When the provider does not open the socket
      Then the client is refused over HTTP, the booking is released and the slot is given back

    @unit
    Scenario: Each relayed Realtime response is one report
      Given the provider sends response.done for three responses
      Then three reports are recorded with text, audio and cached tokens split
      And a final report closes the session when the socket ends

    @unit
    Scenario: A relayed Live socket reports cumulative seconds as deltas
      Given the provider states 12 cumulative seconds
      When the client leaves without closing its session
      Then the gateway sends session.close and bills the final duration the provider states

    @unit
    Scenario: An ElevenLabs speech socket is metered by the characters the client sends
      When the client sends text frames, a keep-alive of one space and the empty closing frame
      Then the characters of every text field are counted, one for the space and none for the empty frame
      And each frame after the first is forwarded byte for byte

    @unit
    Scenario: ElevenLabs speech characters are reported at most once per interval
      Then each report is keyed c-<cumulative characters> and carries the characters since the last one

    @unit
    Scenario: An ElevenLabs transcription socket is metered by the audio the client sends
      When the client sends base64 audio chunks
      Then the decoded byte length over the byte rate of audio_format is reported as audio seconds
      And each report is keyed a-<cumulative milliseconds>

    @unit
    Scenario: A relayed socket over budget gets an error frame and close 1008
      When the receipt of the second response says a budget is exceeded
      Then the client gets an error frame of type budget_exceeded
      And the socket closes with code 1008 and a final report is sent

    @unit
    Scenario: A relayed socket closes when its key is revoked
      When the virtual key is revoked or disabled during the session
      Then the socket closes with code 1008 and reason key_revoked within the key refresh interval

    @unit
    Scenario: A close on one side of a relay reaches the other with its code
      When the provider or the client closes with a code and a reason
      Then the other side is closed with the same code and reason

    @unit
    Scenario: A draining gateway closes relayed sockets with 1012
      Given a relayed socket is still open when the drain budget ends
      Then it keeps relaying until then, closes with code 1012 and its final report is sent

  # ============================================================
  Rule: What the broker deliberately does not do

    @unimplemented
    Scenario: A minted session is terminated mid-call when its budget runs out
      # A minted session runs client to vendor and the gateway holds no socket
      # on it, so admission at the mint is the decision (ADR-097) and overshoot
      # is bounded by session length. A brokered call is ended: see the rules
      # for brokered calls above.

    @unimplemented
    Scenario: The session's tool policy is enforced from the virtual key
      # The tools of a hosted agent live at the vendor, and an OpenAI session
      # declares its own. Enforcing either needs the relay, which stays behind
      # its four gates.

  Rule: The reconciler runs on the worker, not only in principle

    # It was built and never started, which is indistinguishable from working
    # for any workspace whose post-call webhook does arrive — and silent for
    # every workspace whose does not, where nothing is ever billed.

    @integration
    Scenario: The worker starts the voice reconciler when it boots
      Given a worker installed with the gateway module
      When its eventing pipelines register
      Then the voice reconciler is a process manager scheduled once a minute
      # A scheduled process manager ticks once across the fleet and drains with
      # the worker; the api role constructs none of it (ARCHITECTURE.md section 9).

    @unit
    Scenario: A provider with no readable voice key leaves its sessions open
      Given an open session whose conversation id the mint recorded
      And model-provider stores no custom keys for the session's provider row
      When the voice reconciler ticks
      Then the vendor is not asked, nothing is confirmed, and the session stays OPEN
      # The gateway holds no cipher: the keys are model-provider's to decrypt,
      # and a row it cannot answer for is the next tick's, not a zero-cost close.

    @integration
    Scenario: Talk to it reads its ElevenLabs key through model-provider
      Given an organization-scoped ElevenLabs provider row storing an API key
      When the installed api asks the gateway for that row's ElevenLabs credential
      Then it answers the stored key and the vendor's default host
      And a Twilio credential read of the same row is refused as voice_key_missing

