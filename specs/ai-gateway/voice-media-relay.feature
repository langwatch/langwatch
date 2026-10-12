Feature: Twilio media relay on the AI Gateway
  As an operator running phone scenario runs
  I want a worker to dial out to the gateway and have Twilio dial the gateway
  So that Twilio media reaches the worker with no tunnel and no inbound port on the worker

  # https://github.com/langwatch/langwatch/issues/8397, slice 1 (one gateway pod),
  # slice 2 (the cross-pod hop, last Rules of this file).
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
    Scenario: A cloud worker opens a relay with a request signed for one organization
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
        | a signature over another organization path  | invalid_signature       |
        | a signature over /v1/voice/relay            | invalid_signature       |
        | no signature headers                        | missing_signature       |
        | only an lwl_ bearer token                   | missing_signature       |

    @integration
    Scenario Outline: A relay open that carries a body is refused before authentication
      When <route> is sent a request with a 1 MiB body and valid credentials
      Then the response is 400 bad_request
      And no part of the body was read
      And no relay slot is taken

      Examples:
        | route                                  |
        | GET /v1/voice/relay                    |
        | GET /v1/voice/relay/org-1              |
        | GET /v1/voice/relay/org-1, chunked     |

    @integration
    Scenario Outline: An organization id outside the allowed set is refused before upgrade
      When a signed relay is opened for the organization path <path>
      Then the response is 400 or 401
      And no WebSocket is opened
      And no relay slot is taken

      Examples:
        | path                  |
        | /v1/voice/relay/%41   |
        | /v1/voice/relay/%5F   |
        | /v1/voice/relay/a%2Fb |
        | /v1/voice/relay/org%201 |
        | /v1/voice/relay/org.1 |
        | an id of 65 characters |

    @integration
    Scenario: An organization id of 64 allowed characters still opens a relay
      When a signed relay is opened for an id of 64 letters, digits, hyphens and underscores
      Then the first frame is the ready frame with a relay id

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

    @integration
    Scenario: A worker that speaks before Twilio joins is closed with 1008
      Given an open relay that Twilio has not joined
      When the worker sends a data frame
      Then the worker is closed with 1008 and reason "relay_not_paired"
      And its slot is free
      And one relay outcome is counted besides "opened"
      And a later Twilio connect with that id gets 403

    @integration
    Scenario: A relay that ended between the claim and the upgrade closes Twilio with a code
      Given Twilio has claimed a relay id and its upgrade is not yet complete
      When the worker leaves before the upgrade completes
      Then Twilio's socket is closed with a close code, not dropped

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
      When one instance or one organization has two pending relays and opens a third
      Then the third is refused with 503 "voice_relay_unavailable"
      And another instance or organization can still open one

    @integration
    Scenario: Joined relays do not count against the pending cap
      Given a cap of one pending relay per scope
      When the scope's relay is joined by Twilio
      Then the scope can open another relay
      And a further open while that one is pending is refused

    @integration
    Scenario: One scope cannot hold more relays in total than its cap
      Given a cap of two relays per scope and a higher pending cap
      When one instance holds two joined relays and opens a third
      Then the third is refused with 503 "voice_relay_unavailable"
      And it carries a Retry-After header
      And another instance or organization can still open one

    @integration
    Scenario: A scope's slot is reusable once one of its relays ends
      Given a scope at its cap of joined relays
      When one of its relays ends
      Then the scope can open a new relay

    @integration
    Scenario: The total cap per scope defaults to 50
      Given no cap per scope is configured
      When one instance holds 50 joined relays and opens another
      Then the response is 503 "voice_relay_unavailable"

    @integration
    Scenario: A shutdown signal starts the drain
      Given a hub started with a context
      When the context ends
      Then a new relay is refused with 503 and a Retry-After header

    @integration
    Scenario: A paired relay is closed with 1012 once a shutdown signal and the drain budget pass
      Given a relay joined by a Twilio-shaped client on a hub started with a context
      When the context ends and the drain budget passes
      Then the worker is closed with 1012 and reason "relay_drain"

    @integration
    Scenario: Stopping the hub returns once every relay has ended
      Given a joined relay and a short drain budget
      When the hub is stopped with a generous deadline
      Then Stop returns without an error
      And no relay is held

    @integration
    Scenario: Stopping the hub returns the deadline error when the deadline passes first
      Given a joined relay and a long drain budget
      When the hub is stopped with a short deadline
      Then Stop returns the deadline error
      And the relay is then closed with 1012 and reason "relay_drain"

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
        | refused_unpaired | the worker sends a frame before Twilio joins   |
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
    Scenario: A relay id with a byte outside the base64url alphabet is rejected
      When a genuine id has a newline, a carriage return, a space, a tab or a NUL inserted
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
      And the relays per scope default to 50
      And the pod address defaults to empty
      And each can be overridden from the environment
      And a negative value is refused

  # ============================================================
  # Slice 2. Twilio dials the gateway through an L4 load balancer, so its
  # socket can land on a pod that does not hold the relay. Pods are named by
  # the address sealed into the relay id. The pod Twilio landed on dials the
  # owner's hop listener (GATEWAY_RELAY_HOP_ADDR, :5564), which is a second
  # server that serves only GET /relay-hop/{id} behind the internal HMAC, and
  # pumps Twilio's frames over that hop. The scenarios below run two gateway
  # pods in one process, each with its own address (127.0.0.2 and 127.0.0.3)
  # and its own hop listener on one shared port.

  # ============================================================
  Rule: A Twilio socket that lands on another pod is joined through the owner

    @integration
    Scenario: Two concurrent relays on two pods are each joined to the right Twilio socket
      Given gateway pods A and B, each with its own pod address
      And relay R1 opened on A and relay R2 opened on B
      When Twilio T1 for R1 lands on B and Twilio T2 for R2 lands on A
      And each of the four sockets sends 100 tagged text and binary frames
      Then R1 receives exactly T1's frames, in order
      And R2 receives exactly T2's frames, in order
      And T1 receives exactly R1's frames, in order
      And T2 receives exactly R2's frames, in order

    @integration
    Scenario: A hop is counted on both pods
      When Twilio lands on pod B for a relay held by pod A and frames pass
      Then pod B counts hop_joined and does not count paired
      And pod A counts paired and does not count hop_joined

    @integration
    Scenario: Twilio closing the stream ends the hopped relay with 1000
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When Twilio closes the stream with 1000
      Then the relay is closed with 1000

    @integration
    Scenario: The worker closing a hopped relay closes Twilio's socket with 1000
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When the worker closes the relay with 1000
      Then Twilio's socket is closed with 1000

    @integration
    Scenario: Twilio dropping a hopped stream ends the relay with 4502
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When Twilio's TCP connection drops without a close frame
      Then the relay is closed with 4502

    @integration
    Scenario: A hopped relay older than its maximum duration is closed with 4409
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When the maximum relay duration passes
      Then the relay is closed with 4409
      And Twilio's socket is closed with 1000

    @integration
    Scenario: A drain on the pod Twilio reached waits for the hop and closes it with 1012
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When pod B is stopped with a drain budget of 700 milliseconds
      Then Stop waits for the hop through the budget and returns without an error
      And Twilio's socket is closed with 1012

    @integration
    Scenario: A hopped socket is bounded by the maximum relay duration
      Given an owner that accepts the hop and never ends it
      And a maximum relay duration of 300 milliseconds on pod B
      When Twilio lands on pod B with an id naming that owner
      Then Twilio's socket is closed
      And the hop socket to the owner is closed

    @integration
    Scenario: A hopped Twilio socket is closed when the owner vanishes
      Given a Twilio socket hopped to an owner
      When the owner's hop socket drops
      Then Twilio's socket is closed

    @integration
    Scenario: A hopped owner socket is closed when Twilio vanishes
      Given a Twilio socket hopped to an owner
      When Twilio's socket drops
      Then the owner's hop socket is closed

    @integration
    Scenario: An owner whose drain budget ends closes the hopped relay with 1012
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When pod A drains and its budget ends
      Then the relay is closed with 1012 and the reason relay_drain
      And Twilio's socket is closed with 1000

    @integration
    Scenario: A frame over 64 KiB from Twilio through the hop closes Twilio's socket with 1009
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When Twilio sends a frame of 64 KiB plus one byte
      Then Twilio's socket is closed with 1009
      And the relay is closed with 4502

    @integration
    Scenario: A frame over 64 KiB from the worker through the hop closes the relay with 1009
      Given a relay on pod A joined by a Twilio socket that landed on pod B
      When the worker sends a frame of 64 KiB plus one byte
      Then the relay is closed with 1009
      And Twilio's socket is closed with 1000

    @integration
    Scenario: A relay waiting for Twilio that ends in the drain is counted as drained_unpaired
      Given a relay waiting for Twilio on a pod that begins to drain
      When the drain budget ends
      Then the worker is closed with 1012
      And gateway_voice_media_relay_total{outcome="drained_unpaired"} rises by one
      And the voice_media_relay_ended log names the outcome drained_unpaired
      And no other outcome is counted for the end

    @unit
    Scenario: The drained_unpaired outcome is documented
      Then the counter's help text names drained_unpaired
      And the observability page lists drained_unpaired

  # ============================================================
  Rule: The owner decides whether a hop is joined

    @integration
    Scenario Outline: An owner that refuses the hop refuses Twilio
      Given a relay held by pod A
      When Twilio lands on pod B with <id>
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And the answer comes in under a second, not after the hop timeout

      Examples:
        | id                          |
        | an id already joined once   |
        | an id the owner never opened |
        | an id whose relay has ended |

    @integration
    Scenario: A replayed id on another pod leaves the joined pair running
      Given a relay on pod A joined by Twilio
      When a second Twilio socket lands on pod B with the same id
      Then it gets HTTP 403
      And frames still pass between the first pair

    @integration
    Scenario Outline: A hop for a relay whose owner pod restarted is refused with 403
      Given a pending relay on pod A and an id that names its owner address with another boot id
      When <where> receives that id
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket

      Examples:
        | where                                   |
        | pod B, which hops to A                  |
        | pod A's hop port, with a valid signature |
        | pod A's public Twilio route             |

    @integration
    Scenario: A refused stale id leaves the relay joinable with its real id
      Given a pending relay on pod A
      When Twilio lands on pod B with the id's boot id changed, and is refused
      And Twilio then lands on pod B with the real id
      Then the relay is joined and frames pass

  # ============================================================
  Rule: An owner that cannot be reached refuses Twilio at once

    @integration
    Scenario: A hop to an owner with a closed port refuses Twilio quickly
      Given an id whose owner address has nothing listening on the hop port
      When Twilio lands on pod B with that id
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And the answer comes in under a second
      And the log carries "relay_owner_unreachable"
      And gateway_voice_media_relay_total{outcome="refused_owner_unreachable"} rises by one
      And the log does not hold the full relay id

    @integration
    Scenario: A hop to an owner that never answers refuses Twilio within the hop timeout
      Given an owner that accepts TCP on the hop port and never answers
      And a hop timeout of 400 milliseconds
      When Twilio lands on pod B with an id naming that owner
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And the answer comes after the hop timeout and before two seconds
      And the log carries "relay_owner_unreachable"
      And gateway_voice_media_relay_total{outcome="refused_owner_unreachable"} rises by one
      And the abandoned connection to the owner is closed

    @integration
    Scenario Outline: An owner address outside the private ranges is refused without a dial
      Given an id sealed with a valid key whose owner address is <owner>
      When Twilio lands on pod B with that id
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And gateway_voice_media_relay_total{outcome="refused_owner_invalid"} rises by one
      And the log carries "relay_owner_invalid"
      And no connection is made to the hop port

      Examples:
        | owner                     |
        | 8.8.8.8                   |
        | 169.254.169.254           |
        | 100.128.0.1               |
        | 0.0.0.0                   |
        | ::                        |
        | localhost                 |
        | 127.0.0.2:80              |
        | 127.0.0.2/x               |
        | x@127.0.0.2               |
        | 127.0.0.2 (trailing space) |
        | ::ffff:8.8.8.8            |

    @unit
    Scenario: Only private addresses are dialed as owners
      When an owner address is checked
      Then 10/8, 172.16/12, 192.168/16, 100.64/10, 127/8 and fc00::/7 literals are accepted
      And every other IP literal is refused, at and beside each range edge
      And a host name, a port, a path, a zone, a space, brackets, userinfo or a leading zero is refused
      And an IPv4-mapped public address is refused

    @integration
    Scenario: The hop dial cap refuses further hops without a dial
      Given a hop dial cap of 1 and an owner that never answers
      And one hop dial is waiting on that owner
      When Twilio lands on pod B with a second id
      Then Twilio gets HTTP 403 voice_relay_forbidden at once
      And the owner saw only one connection
      And gateway_voice_media_relay_total{outcome="refused_hop_busy"} rises by one
      And the dial that held the cap ends as an unreachable owner
      And a later hop dials the owner again

    @integration
    Scenario: A hop owner that answers with a redirect refuses Twilio
      Given an owner that answers the hop with a 307 redirect to another host
      When Twilio lands on pod B with an id naming that owner
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And the redirect target receives no request
      And the signature headers never reach the redirect target

    @unit
    Scenario: The hop client follows no redirect and uses no proxy
      When the hop client of a relay hub is read
      Then its transport has no proxy function
      And its redirect policy returns the last response
      And the same client serves every dial of the hub

    @integration
    Scenario: Twilio giving up during the hop dial is not counted as an unreachable owner
      Given an owner that accepts TCP on the hop port and never answers
      And a hop dial cap of 1
      When Twilio cancels its request while pod B dials the owner
      Then the log does not carry "relay_owner_unreachable"
      And gateway_voice_media_relay_total{outcome="refused_owner_unreachable"} does not rise
      And a later hop dials the owner

    @integration
    Scenario: A relay id with a line break inserted is refused without a dial
      Given a genuine id that names pod A
      When Twilio lands on pod B with a newline, a carriage return or both inserted into the id
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And gateway_voice_media_relay_total{outcome="refused_unknown"} rises for each
      And refused_owner_unreachable is not counted
      And no connection is made to the hop port

    @integration
    Scenario: A pod without an address refuses an id that names an owner
      Given a gateway pod with no pod address
      When Twilio connects with an id that names an owner address
      Then Twilio gets HTTP 403 voice_relay_forbidden and no WebSocket
      And no connection is made to the hop port
      And gateway_voice_media_relay_total{outcome="refused_unknown"} rises by one

    @integration
    Scenario: A pod without an address still serves its own ids
      Given a gateway pod with no pod address
      When a relay is opened and Twilio connects with its id
      Then frames pass

  # ============================================================
  Rule: The hop listener is not the public listener

    @integration
    Scenario Outline: A hop request without a valid signature is refused with 401
      Given a pending relay and the owner's hop listener
      When the hop is dialed with <credential>
      Then the response is 401 with error code <code>
      And the relay is still waiting for Twilio

      Examples:
        | credential                         | code                    |
        | no signature headers               | missing_signature       |
        | a bad signature                    | invalid_signature       |
        | a signature 301 seconds old        | timestamp_out_of_window |
        | a signature over another path      | invalid_signature       |
        | a signature over the public path   | invalid_signature       |
        | only an lwl_ bearer token          | missing_signature       |

    @integration
    Scenario: A hop request that is not an upgrade, or carries a body, is refused with 400
      Given a pending relay and the owner's hop listener
      When a plain signed GET is sent to the hop route
      And a signed upgrade with a body is sent to the hop route
      Then both responses are 400
      And the relay is still waiting for Twilio

    @integration
    Scenario Outline: The public router serves no relay-hop route
      Given a pending relay
      When a signed upgrade is sent to <path> on the public listener
      Then the response is 404
      And the relay is still waiting for Twilio

      Examples:
        | path                 |
        | /relay-hop/{id}      |
        | /v1/relay-hop/{id}   |

    @integration
    Scenario Outline: The hop listener serves only the hop route
      Given a pending relay
      When a signed upgrade with an lwl_ bearer is sent to <path> on the hop listener
      Then the response is 404

      Examples:
        | path                         |
        | /v1/voice/twilio/{id}        |
        | /v1/voice/relay              |
        | /v1/voice/relay/org-1        |
        | /healthz                     |
        | /metrics                     |
        | /                            |

    @integration
    Scenario: The hop listener stops after the media relay hub and the public listener
      Given the managed services of a gateway with a media relay and a hop listener
      Then the hop listener is registered before the media relay hub and before the public listener
      And so it stops after both, and serves through the whole voice drain

    @integration
    Scenario: A gateway without a hop listener registers none
      Given the managed services of a gateway without a hop listener
      Then no relay-hop service is registered

    @unit
    Scenario: A gateway without a pod address registers no hop listener
      Given a gateway with a media relay and no pod address
      Then no hop server is built
      And no relay-hop service is registered

    @unit
    Scenario: A gateway with a pod address serves the hop on the hop address
      Given a gateway with a media relay and a pod address
      Then the hop server listens on the configured hop address

    @unit
    Scenario: The hop listener never has an empty address
      Then the default configuration sets the hop address to ":5564"
      And a hop server built from a configuration without an address does not have an empty one

    @integration
    Scenario: A draining owner still accepts a hop for its pending relay
      Given a pending relay on pod A
      When pod A begins to drain
      And Twilio lands on pod B with the relay id
      Then the relay is joined through the hop and frames pass

  # ============================================================
  Rule: The relay id can be sealed with a key of its own

    @integration
    Scenario: A gateway-only key seals relay ids when it is set
      Given gateway pods with a relay id key
      When a relay is opened
      Then its id opens with the key and names the pod address
      And its id does not open with the internal secret

    @integration
    Scenario: Relay ids sealed with the gateway-only key hop between pods
      Given gateway pods with a relay id key and one internal secret
      When Twilio lands on pod B for a relay held by pod A
      Then the relay is joined through the hop and frames pass

    @integration
    Scenario: An id sealed with the internal secret is refused when a gateway-only key is set
      Given gateway pods with a relay id key
      When Twilio connects with an id for a pending relay sealed with the internal secret
      Then Twilio gets HTTP 403 voice_relay_forbidden

  # ============================================================
  Rule: The hop keeps ids and payloads out of telemetry

    @integration
    Scenario: The relay id never appears in full in hop logs
      Given a hopped relay, a stale-boot probe, a hop with a bad signature and a replay
      Then no log entry of either pod holds more than a short prefix of the relay id
      And no log entry of either pod holds more than a short prefix of the refused id

    @integration
    Scenario: Frame payloads never appear in hop logs
      Given a hopped relay
      When a marker string passes in both directions
      Then no log entry of either pod contains the marker

    @integration
    Scenario: Metric labels never carry a relay id
      When a relay is hopped, closed and replayed
      Then the only label on gateway_voice_media_relay_total is outcome
      And its values are from the fixed outcome set, hop outcomes included

    @unit
    Scenario: The hop outcomes are documented
      Then the counter's help text names hop_joined, refused_owner_unreachable, refused_owner_invalid and refused_hop_busy
      And the observability page lists the same four outcomes

  # ============================================================
  Rule: Hop settings are configured from the environment

    @unit
    Scenario: Hop settings come from the environment
      When the gateway loads its configuration
      Then the hop address defaults to ":5564"
      And the hop timeout defaults to 3 seconds
      And the maximum hop dials default to 64
      And the relay id key defaults to empty
      And each can be overridden from the environment

    @unit
    Scenario: A negative hop setting is refused
      When the hop timeout or the maximum hop dials is negative
      Then the gateway refuses to start and names the variable

    @unit
    Scenario: The hop address must be a host and a port
      When the hop address is "garbage", "5564", ":", ":0", ":notaport", ":70000" or "host:"
      Then the gateway refuses to start and names GATEWAY_RELAY_HOP_ADDR

    @unit
    Scenario: The relay id key must be at least 32 bytes
      When the relay id key is 31 bytes
      Then the gateway refuses to start and names LW_GATEWAY_VOICE_RELAY_ID_KEY
      And a key of 32 bytes is accepted
      And the length is counted in bytes, not characters

    @unit
    Scenario: The relay id key is never echoed in a refusal
      When a short relay id key is refused
      Then the error text does not contain the key

    @unit
    Scenario: A pod address outside the private ranges is refused at start
      When the pod address is public, a host name, has a port, is link-local or is an IPv4-mapped public address
      Then the gateway refuses to start and names GATEWAY_POD_IP
      And 10/8, 172.16/12, 192.168/16, 100.64/10 and fc00::/7 addresses are accepted
      And an unset pod address is accepted

    @unit
    Scenario: The media relay hub is built from the configuration
      When the hub options are built from a configuration
      Then they carry the internal secret, the pod address and the hop port read from the hop address
      And they carry the hop timeout, the maximum hop dials and the relay id key
      And they carry the relay limits

    @unit
    Scenario: The hop port is read from the hop address
      When the hop address is ":5564", "0.0.0.0:6000", "[::]:7000" or "127.0.0.1:5570"
      Then the port is 5564, 6000, 7000 or 5570
      And an empty address, a bare word, port 0, a non-number or a port above 65535 is refused

  # ============================================================
  Rule: The chart wires the hop

    @unit
    Scenario: The pod address and the hop port reach the container
      When the gateway chart is rendered
      Then the container env GATEWAY_POD_IP comes from the downward API field status.podIP
      And the container has a port named relay-hop at 5564
      And GATEWAY_RELAY_HOP_ADDR is ":5564" in the ConfigMap
      And relayHop.port changes both the container port and the address

    @unit
    Scenario: The hop port is open only to the gateway's own pods
      When the gateway chart is rendered with the network policy enabled
      Then an ingress rule allows TCP 5564 from pods with the gateway's selector labels and nothing else
      And an egress rule allows TCP 5564 to pods with the gateway's selector labels and nothing else
      And no other ingress rule opens 5564

    @unit
    Scenario: The hop port is not published by a Service
      When the gateway chart is rendered with the internal Service enabled
      Then no Service has port 5564
      And no Service targets the relay-hop port

    @unit
    Scenario: The relay id key reaches the container from a secret
      When the gateway chart is rendered with secrets.relayIdKey set
      Then LW_GATEWAY_VOICE_RELAY_ID_KEY is a secretKeyRef on secrets.existingSecretName with that key
      And the key is not in the ConfigMap
      And nothing renders for it while secrets.relayIdKey is unset

    @unit
    Scenario: The docs say who may reach the hop port
      When the realtime docs are read
      Then they say the hop port is limited to the gateway's pods only when networkPolicy.enabled is true
      And they say the hop is plain ws inside the pod network
      And they name the chart value secrets.relayIdKey
