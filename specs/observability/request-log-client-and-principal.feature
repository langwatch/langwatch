Feature: The request log names who called and from where

  Every HTTP request leaves one access record (see one-request-one-log-record.feature).
  That record says what was asked and how it was answered, but not who asked or from
  which address. Reading the log alone, a reviewer cannot tell two callers apart or
  follow one credential across requests.

  The record now carries the client address, the user or API key acting, and the
  kind of key. The key itself and every secret stay out of it.

  The client address comes from the one resolver the API already uses for its per-address
  limits and its audit trail, so the log and those limits never disagree about the caller.

  `CF-Connecting-IP` is written by Cloudflare, but anyone who can reach the origin without
  passing through Cloudflare can write it too. Behind a network load balancer the app sees
  a node address as its peer, so it cannot check that the peer is Cloudflare. The header is
  therefore trusted only when the deployment says every request reaches it through
  Cloudflare (`TRUST_CLOUDFLARE_CLIENT_IP`, off by default). Off, the header is ignored and
  the address comes from the forwarded-for chain or the socket, as before.

  Logging never fails a request: a malformed header, or a caller the log cannot describe,
  leaves that field out of the record and the request is answered as usual.

  @unit
  Scenario: The Cloudflare client address is used when the deployment trusts Cloudflare
    Given the deployment trusts the Cloudflare client address header
    When a request arrives carrying a valid Cloudflare client address
    Then the client address is the one Cloudflare wrote

  @unit
  Scenario: A Cloudflare client address header is ignored when the deployment does not trust Cloudflare
    Given the deployment does not trust the Cloudflare client address header
    When a request arrives carrying a Cloudflare client address it wrote itself
    Then the client address comes from the forwarded-for chain or the socket instead

  @unit
  Scenario: Trusting Cloudflare falls back when the header is absent
    Given the deployment trusts the Cloudflare client address header
    When a request arrives with no Cloudflare client address
    Then the client address comes from the forwarded-for chain or the socket

  @unit
  Scenario: A malformed Cloudflare client address is ignored
    Given the deployment trusts the Cloudflare client address header
    When a request arrives whose Cloudflare client address is not an IP address
    Then the header is ignored without an error
    And the client address comes from the forwarded-for chain or the socket

  @unit
  Scenario: An IPv6 Cloudflare client address is accepted
    Given the deployment trusts the Cloudflare client address header
    When a request arrives carrying an IPv6 Cloudflare client address
    Then the client address is that IPv6 address

  @unit
  Scenario: The request log names the client address
    Given a request whose client address was resolved
    When the request is answered
    Then its access record carries that client address

  @unit
  Scenario: The request log names the user behind a session
    Given a request authenticated as a signed-in user
    When the request is answered
    Then its access record carries that user's id

  @unit
  Scenario: The request log names the API key and its kind, never the key
    Given a request authenticated by an API key
    When the request is answered
    Then its access record carries the key's id and its kind
    And it carries nothing of the key's secret

  @unit
  Scenario: A request with no caller names no principal
    Given a request that presented no credential
    When the request is answered
    Then its access record carries no user, no key id and no key kind
