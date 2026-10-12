Feature: Twilio media relay on the AI Gateway
  As an operator running phone scenario runs
  I want a worker to dial out to the gateway and have Twilio dial the gateway
  So that Twilio media reaches the worker with no tunnel and no inbound port on the worker

  # https://github.com/langwatch/langwatch/issues/8397, slice 1 (one gateway pod).
  # The worker opens GET /v1/voice/relay (or the signed GET /v1/voice/relay/{orgId}),
  # is told a relay id, and places the Twilio call with
  # <Stream url="wss://gateway/v1/voice/twilio/{id}">. Twilio then dials the
  # gateway with that id and nothing else: the id is the credential on that
  # leg. The gateway joins the two sockets and moves frames verbatim.
  #
  # Close codes sent to the worker: 4408 relay_expired, 4409 relay_max_duration,
  # 4502 relay_peer_lost, 1012 relay_drain, 1000 normal end, 1009 frame too big.

  Background:
    Given the gateway is running with an internal secret
    And a licensed install whose lwl_ token resolves for instance "instance-a"

  # ============================================================
  Rule: A worker opens a relay and is told where Twilio must connect

    @integration
    Scenario: A licensed install opens a relay and is told where Twilio must connect
      When the install upgrades GET /v1/voice/relay with its lwl_ token and instance id
      Then the first frame is one text frame with event "langwatch.relay.ready"
      And it carries a relay_id without a slash
      And it carries stream_path "/v1/voice/twilio/" followed by the relay_id
      And it carries expires_in_seconds equal to the pending time to live
      And the auth resolver saw the instance id "instance-a"

    @integration
    Scenario: A relay id fits in a Twilio stream URL
      When a relay is opened on a pod with an address and a boot id
      Then the relay id is at most 120 characters of base64url

    @integration
    Scenario: A relay request that is not a WebSocket upgrade is refused with 400
      When a plain GET is sent to /v1/voice/relay with a valid lwl_ token
      And a plain GET is sent to /v1/voice/relay/org-1 with a valid signature
      Then both responses are 400 bad_request

    @integration
    Scenario: A cloud worker opens a relay with a request signed for one organisation
      When the worker upgrades GET /v1/voice/relay/org-1 with a valid HMAC signature over that path
      Then the first frame is the ready frame with a relay id

    @integration
    Scenario Outline: The relay socket is refused before upgrade
      When a relay is opened with <credential>
      Then the response is <status> with error code <code>
      And no WebSocket is opened
      And no relay slot is taken

      Examples:
        | credential                         | status | code                         |
        | no credential                      | 401    |                              |
        | an unregistered lwl_ token         | 401    | connect_license_not_registered |
        | a revoked lwl_ token               | 403    | connect_license_revoked      |
        | an expired lwl_ token              | 403    | connect_license_expired      |
        | an lwl_ token on the wrong instance | 403   | connect_wrong_instance       |
        | a virtual key                      | 403    | voice_relay_license_required |
        | HMAC headers and no bearer         | 401    |                              |

    @integration
    Scenario Outline: The signed relay route is refused before upgrade
      When a relay is opened on /v1/voice/relay/org-1 with <credential>
      Then the response is 401 with error code <code>
      And no WebSocket is opened
      And no relay slot is taken

      Examples:
        | credential                                  | code                    |
        | a bad signature                             | invalid_signature       |
        | a signature 301 seconds old                 | timestamp_out_of_window |
        | a signature over another organisation path  | invalid_signature       |
        | a signature over /v1/voice/relay            | invalid_signature       |
        | no signature headers                        | missing_signature       |
        | only an lwl_ bearer token                   | missing_signature       |

    @integration
    Scenario: A gateway without an internal secret refuses signed relays
      Given the gateway has no internal secret
      When a relay is opened on /v1/voice/relay/org-1 with a signature
      Then the upgrade is refused
      And no relay slot is taken

  # ============================================================
  Rule: Twilio's socket is joined to the relay

    @integration
    Scenario: Frames pass between Twilio and the worker unchanged and in order
      Given a relay joined by a Twilio-shaped client
      When each side sends 500 text and binary frames
      Then the other side receives them byte for byte, in order, with their frame types
      And a binary frame of exactly 64 KiB passes in both directions

    @integration
    Scenario: A relay opened by a signed request is joined the same way
      Given a relay opened with a signed request
      When a Twilio-shaped client connects to its stream path
      Then a frame sent by either side arrives at the other

    @integration
    Scenario Outline: Twilio's socket is refused before upgrade
      When a Twilio-shaped client connects with <id>
      Then the response is HTTP 403 with error code "voice_relay_forbidden"
      And no WebSocket is opened

      Examples:
        | id                                                     |
        | a random string                                        |
        | an id sealed with another key                          |
        | an expired id                                          |
        | an id never opened on this pod                         |
        | an id owned by another pod                             |
        | an id already joined once                              |
        | an id whose Twilio socket has since closed             |
        | an id whose relay was closed by the worker             |

    @integration
    Scenario: A replayed id does not disturb the pair that holds it
      Given a relay joined by a Twilio-shaped client
      When a second client connects with the same id and is refused
      Then the first pair still passes frames

    @integration
    Scenario: A plain GET to the Twilio path does not use up the relay id
      Given an open relay
      When a plain GET is sent to its stream path
      Then the response is 400
      And a Twilio-shaped client can still join the relay

    @integration
    Scenario: No compression is negotiated on either socket
      When the worker and Twilio each offer permessage-deflate
      Then neither handshake answers a Sec-WebSocket-Extensions header

    @integration
    Scenario: A relay id owned by this pod's address is accepted
      Given the gateway knows its own pod address
      When a relay is opened and joined
      Then frames pass between the two sockets

  # ============================================================
  Rule: A relay nobody joins expires

    @integration
    Scenario: A relay nobody joins expires
      Given a relay with a short pending time to live
      When no Twilio socket arrives in time
      Then the relay is closed with 4408 and reason "relay_expired"
      And a later Twilio connect with that id gets 403
      And its slot is free

    @integration
    Scenario: A relay waiting for Twilio is pinged
      Given a relay with a short ping interval
      When it waits for Twilio
      Then the worker receives pings

    @integration
    Scenario: Joining stops the pending clock
      Given a relay with a short pending time to live
      When Twilio joins in time
      Then the pair is still open after the pending time has passed

  # ============================================================
  Rule: Either side ending the stream ends the relay

    @integration
    Scenario: Twilio closing the stream closes the relay with 1000
      Given a relay joined by a Twilio-shaped client
      When Twilio closes its socket with 1000
      Then the relay is closed with 1000

    @integration
    Scenario: The worker closing the relay closes Twilio's socket with 1000
      Given a relay joined by a Twilio-shaped client
      When the worker closes the relay with 1000
      Then Twilio's socket is closed with 1000

    @integration
    Scenario: Twilio's socket dropping abnormally closes the relay with 4502
      Given a relay joined by a Twilio-shaped client
      When Twilio's TCP connection drops with no close frame
      Then the relay is closed with 4502 and reason "relay_peer_lost"

    @integration
    Scenario: A frame over 64 KiB closes the pair with 1009
      Given a relay joined by a Twilio-shaped client
      When Twilio sends a frame of 64 KiB plus one byte
      Then both sockets are closed with 1009

    @integration
    Scenario: The gateway keeps serving after an oversized frame
      Given a pair closed by an oversized frame from the worker
      Then Twilio's socket is closed
      And a new relay can be opened and joined

    @integration
    Scenario: A relay older than its maximum duration is closed with 4409
      Given a relay with a short maximum duration
      When the pair outlives it
      Then the relay is closed with 4409 and reason "relay_max_duration"
      And Twilio's socket is closed

    @integration
    Scenario: The maximum duration runs from the join, not from the open
      Given a relay that waited before Twilio joined
      When the time since the open passes the maximum duration but the time since the join does not
      Then frames still pass
      And the relay is closed with 4409 once the join is old enough

  # ============================================================
  Rule: A draining or full gateway refuses new relays

    @integration
    Scenario: A draining gateway refuses new relays with 503
      Given the gateway is draining
      When a relay is opened with an lwl_ token or a signature
      Then the response is 503 with error code "voice_relay_unavailable"
      And it carries a Retry-After header
      And no relay slot is taken

    @integration
    Scenario: A paired relay keeps running while the gateway drains and ends with 1012
      Given a relay joined by a Twilio-shaped client
      When the gateway begins to drain
      Then frames still pass in both directions
      And when the drain budget ends the relay is closed with 1012 and reason "relay_drain"
      And Twilio's socket is closed

    @integration
    Scenario: A relay waiting for Twilio can still be joined while the gateway drains
      Given an open relay
      When the gateway begins to drain
      And Twilio connects with the relay id
      Then frames pass between the two sockets

    @integration
    Scenario: A full gateway refuses new relays with 503
      Given the gateway holds its maximum number of relays
      When another relay is opened
      Then the response is 503 with error code "voice_relay_unavailable"
      And it carries a Retry-After header

    @integration
    Scenario: A slot is reusable once its relay ends
      Given the gateway holds its maximum of one relay
      When that relay ends, by the worker closing it or by Twilio closing the pair
      Then a new relay can be opened

    @integration
    Scenario: One scope cannot hold more pending relays than its cap
      Given a cap of two pending relays per scope
      When one instance or one organisation has two pending relays and opens a third
      Then the third is refused with 503 "voice_relay_unavailable"
      And another instance or organisation can still open one

    @integration
    Scenario: Joined relays do not count against the pending cap
      Given a cap of one pending relay per scope
      When the scope's relay is joined by Twilio
      Then the scope can open another relay
      And a further open while that one is pending is refused

  # ============================================================
  Rule: Every relay outcome is counted

    @integration
    Scenario Outline: Each relay outcome is counted once
      When <case>
      Then gateway_voice_media_relay_total moves only for <outcome>

      Examples:
        | outcome          | case                                           |
        | opened           | a relay is opened                              |
        | paired           | Twilio joins a relay                           |
        | refused_auth     | a virtual key opens a relay                    |
        | refused_auth     | a bad signature opens a relay                  |
        | refused_unknown  | Twilio connects with a random string           |
        | refused_expired  | Twilio connects with an expired id             |
        | refused_replay   | Twilio connects with an id already joined      |
        | expired_unpaired | nobody joins a relay in time                   |
        | dropped          | Twilio's TCP connection drops                  |
        | completed        | Twilio closes the stream with 1000             |

    @integration
    Scenario: Metric labels never carry a relay id
      When a relay is opened, joined and closed
      Then the only label on gateway_voice_media_relay_total is outcome
      And its values are from the fixed outcome set

    @unit
    Scenario: The relay outcome counter has one label
      When the recorder counts an outcome
      Then gateway_voice_media_relay_total{outcome} rises by one
      And a nil recorder counts nothing and does not panic

  # ============================================================
  Rule: Credentials and payloads stay out of telemetry

    @integration
    Scenario: The relay id never appears in full in logs or spans
      Given a relay joined, closed and probed with a tampered id
      Then no span name or attribute holds the full relay id
      And no log entry holds the full relay id
      And the Twilio request span still carries the path prefix

    @integration
    Scenario: Frame payloads never appear in logs
      Given a relay joined by a Twilio-shaped client
      When a marker string passes in both directions
      Then no log entry contains the marker

    @unit
    Scenario: A relay id in a path is cut to a short prefix where the path is recorded
      When a path under /v1/voice/twilio/ or /relay-hop/ is recorded
      Then only the first 8 characters of the id remain, followed by "..."
      And the recover log, the access log and the server span all use that form
      And other paths are unchanged

  # ============================================================
  Rule: The upgrade works in the real router

    @integration
    Scenario: The upgrade works through the production middleware chain
      Given the router from NewRouter with metrics, tracer and telemetry middleware
      Then a relay upgrade and a Twilio upgrade both succeed
      And the responses carry the gateway version and request id headers
      And frames pass

    @integration
    Scenario: A vendor voice socket still upgrades when the media relay is mounted
      Given the media relay and the vendor voice relay are both mounted
      When a client upgrades /v1/realtime with a virtual key
      Then the upgrade succeeds and its frames reach the vendor

  # ============================================================
  Rule: A relay id is sealed

    @unit
    Scenario: A sealed relay id carries its owner and expiry
      When an id is sealed for an owner pod address, boot id and expiry
      Then unsealing it with the same secret returns the same owner, boot id and expiry
      And the claims carry 128 random bits

    @unit
    Scenario: Two relay ids for the same claims differ
      When an id is sealed twice for the same claims
      Then the two ids differ

    @unit
    Scenario: A relay id does not reveal its owner address
      When an id is sealed for an owner pod address
      Then the address is not readable in the decoded id

    @unit
    Scenario: A relay id sealed with another secret is rejected
      When an id is unsealed with a different secret
      Then it is rejected as invalid

    @unit
    Scenario: A tampered relay id is rejected
      When one character of an id is changed
      Then it is rejected as invalid

    @unit
    Scenario: A malformed relay id is rejected
      When an empty, short, long, padded or non-base64url string is unsealed
      Then it is rejected as invalid

    @unit
    Scenario: An expired relay id is reported as expired
      When an id is unsealed at or after its expiry
      Then it is rejected as expired
      And one second earlier it is accepted

    @unit
    Scenario: A codec without a secret refuses to seal
      When an id is sealed or unsealed with an empty secret
      Then it fails

  # ============================================================
  Rule: Relay limits are configured from the environment

    @unit
    Scenario: Relay limits come from the environment
      When the gateway loads its configuration
      Then the pending time to live defaults to 150 seconds
      And the maximum relay duration defaults to 330 seconds
      And the maximum number of relays defaults to 500
      And the pending relays per scope default to 20
      And the pod address defaults to empty
      And each can be overridden from the environment
      And a negative value is refused
