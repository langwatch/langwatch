Feature: The fence a customer-supplied webhook leaves through

  A webhook destination is a URL the CUSTOMER typed, and it is the only
  outbound address in the product that a customer can point at our own private
  network. Everything between "an automation fired" and "bytes reached the
  receiver" is therefore policy rather than plumbing: which addresses are
  admitted at all, whether a redirect may move the destination after admission,
  how many dispatches an hour a tenant may spend, and what proves to the
  receiver that the bytes are ours.

  That policy used to exist once, inside the application. It is now a package,
  because three callers owe the same answer — the graph-alert half of
  Automation running in a background process, the Enterprise webhook endpoints
  platform, and any transport that wants the same fence — and a fence
  re-implemented per process is how two fences end up disagreeing. While both
  graphs run, the application keeps its copy and this one is its frozen twin.

  Drift here is silent in the worst way. A rule that quietly loosened does not
  fail anything: it delivers, to an address it should have refused. So the
  rules below are pinned as literals rather than read back out of the source
  they are meant to be guarding, and the signature is pinned against the
  published cross-language vectors rather than against a local idea of the
  algorithm.

  Rule: Admission decides the destination before a connection exists

    @unit
    Scenario: Only https on the default port is admitted
      Given the webhook URL admission policy with no escape hatch
      When it inspects a destination
      Then https on the default port is admitted
      And http, a non-default port, a missing host and a non-URL string are each
        refused with the rule they broke

    @unit
    Scenario: A URL carrying credentials is refused whatever else is relaxed
      Given the webhook URL admission policy
      When it inspects a destination carrying a username or a password
      Then the destination is refused as carrying credentials
      And it is refused with the escape hatch on as well

    @unit
    Scenario: A private or loopback address is refused terminally
      Given the webhook URL admission policy with no escape hatch
      When it is asked to admit a loopback, private, link-local or metadata IP
        literal
      Then it refuses permanently rather than retryably
      And a bracketed IPv6 loopback is refused by the same rule

    @unit
    Scenario: The escape hatch relaxes the origin and the local-address block, and nothing else
      Given the webhook URL admission policy with the escape hatch on
      When it inspects a plain-http loopback destination on a non-default port
      Then the destination is admitted
      And a scheme that is neither http nor https is still refused

    @unit
    Scenario: A send refuses a fenced address before it opens a connection
      Given a webhook sender over the packaged fence
      When a dispatch names a loopback, private, link-local, metadata or
        cloud-internal destination
      Then the dispatch fails permanently
      And no request was made

  Rule: The fence resolves the address it will actually connect to

    @unit
    Scenario: A hostname that resolves into a private range is refused
      Given the strict address policy
      When a hostname resolves to a private address
      Then validation refuses it
      And the same hostname resolving to a public address is admitted and pinned
        to the resolved IP

    @unit
    Scenario: A cloud metadata host is refused whatever the local-address policy says
      Given the permissive address policy
      When it validates a cloud metadata host or a cloud-internal domain
      Then validation refuses it

    @unit
    Scenario: An allowlisted host never bypasses the metadata refusal
      Given an address policy that allowlists a metadata host by name
      When it validates that host
      Then validation refuses it

  Rule: A redirect may not move a destination that was already admitted

    @unit
    Scenario: A redirect is refused rather than followed
      Given a webhook sender over the packaged fence
      When the receiver answers a redirect toward another address
      Then the delivery fails permanently
      And the address the redirect named was never contacted

    @unit
    Scenario: A redirect cannot be followed without a policy to judge the hop
      Given a fenced fetch asked to follow redirects with no address policy for
        the next hop
      When the receiver answers a redirect
      Then the hop is refused rather than taken

    @unit
    Scenario: A redirect with no location is the receiver's answer, not a hop
      Given a webhook sender over the packaged fence
      When the receiver answers a bare 3xx with no location
      Then the status is returned for the caller to classify

  Rule: A tenant cannot turn the process into an outbound flood

    @unit
    Scenario: The hourly dispatch cap backs a flood off rather than dropping it
      Given a webhook sender whose scope has reached its hourly dispatch cap
      When another dispatch is attempted
      Then it fails retryably with the time the window resets in
      And the receiver was never contacted

    @unit
    Scenario: A test fire rides the author's own limit, not the tenant's cap
      Given a webhook sender with a dispatch cap
      When a test fire is sent
      Then the cap is not consulted

    @unit
    Scenario: The cap counts one attempt per dispatch under the key the tenant is billed by
      Given a webhook sender with a dispatch cap
      When a real dispatch is attempted for a scope
      Then the cap is asked once, for that scope's hourly window

  Rule: The receiver can prove the bytes are ours

    @unit
    Scenario: The signature reproduces the published vectors byte for byte
      Given the published cross-language signature vectors
      When the packaged signer signs each vector's body at its timestamp
      Then it produces that vector's header exactly

    @unit
    Scenario: The packaged verifier answers every published verification vector
      Given the published cross-language signature vectors
      When the packaged verifier checks each one against the secrets its receiver
        holds
      Then it accepts exactly the vectors published as valid

    @unit
    Scenario: A rotation window signs with every valid secret, newest first
      Given a dispatch with two signing secrets
      When it is sent
      Then the signature header carries one signature per secret in that order
      And a receiver holding either secret verifies the delivery

    @unit
    Scenario: A dispatch with no secret carries no signature header at all
      Given a dispatch with no signing secret
      When it is sent
      Then no signature header is present
      And an empty secret list sends the same headers as no secret at all

  Rule: The envelope is the same on every attempt

    @unit
    Scenario: Every delivery carries the dispatch identity its channel publishes
      Given a dispatch carrying a stable identity
      When it is sent
      Then the identity rides in the automations channel's header by default
      And a caller may name the header its own channel publishes instead

    @unit
    Scenario: A dispatch with no identity is given one rather than sent without
      Given a dispatch naming no identity
      When it is sent
      Then a fresh identity is generated and reported back to the caller

    @unit
    Scenario: A reserved header a customer set is never sent
      Given a dispatch whose customer headers name reserved and malformed keys
      When it is sent
      Then those headers are dropped and the LangWatch envelope is intact
      And a header still carrying the unresolved kept marker is dropped as well

  Rule: A hostile receiver cannot hurt the process

    @unit
    Scenario: The response body is read only as far as the cap and then cancelled
      Given a receiver streaming a body that never ends
      When the sender reads the answer
      Then it stops at the response cap
      And it tears the transfer down rather than draining it

    @unit
    Scenario: A slow receiver is abandoned at the timeout, retryably
      Given a receiver that accepts the connection and never answers
      When the sender waits
      Then the dispatch fails inside the request timeout
      And the failure is retryable, because a timeout is transient

  Rule: The status decides retry from terminal

    @unit
    Scenario: Server errors retry, everything else that is not success is terminal
      Given a classified webhook status
      When the receiver answers
      Then 2xx is success, 5xx and 429 and 408 are retryable, and any other
        status is terminal
      And a retryable answer carries the receiver's own back-off, while a
        terminal one carries none

  Rule: A background process can compose the whole path from what it holds

    @unit
    Scenario: A process builds the webhook transport from its own configuration
      Given a background process holding its deployment configuration
      When it composes the webhook transport
      Then it needs no configuration the process had not already read
      And a destination the fence refuses fails the dispatch permanently, before
        any connection and without spending the tenant's cap

    @unit
    Scenario: The dispatch cap is counted where the whole fleet can see it
      Given a background process holding a shared counter
      When a dispatch is attempted for a scope already over the cap
      Then the dispatch backs off retryably instead of contacting the receiver
      And the count was taken under the key both graphs share

    @unit
    Scenario: The delivery port stops refusing webhook automations by name
      Given a background process composing the graph-alert delivery adapter with
        the transport it now holds
      When a webhook alert is dispatched through that adapter
      Then the refusal it meets is the fence's judgement of the address
      And it is no longer the adapter reporting that this process owns no sender

    @unit
    Scenario: A process with no shared counter still bounds the burst
      Given a background process with no shared counter for the dispatch cap
      When dispatches exceed the hourly cap within one process
      Then the cap still refuses, per process rather than per fleet
