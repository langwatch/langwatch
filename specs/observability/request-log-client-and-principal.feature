Feature: The request log names who called and from where

  Every HTTP request leaves one access record (see one-request-one-log-record.feature).
  That record says what was asked and how it was answered, but not who asked or from
  which address. Reading the log alone, a reviewer cannot tell two callers apart or
  follow one credential across requests.

  The record now carries the client address, the user or API key acting, and the
  kind of key. The key itself and every secret stay out of it.

  The client address comes from the one resolver the API already uses for its per-address
  limits and its audit trail, so the log and those limits never disagree about the caller.

  How that resolver trusts forwarding headers, Cloudflare's included, is specified in
  specs/security/trusted-client-address.feature.

  Logging never fails a request: a malformed header, or a caller the log cannot describe,
  leaves that field out of the record and the request is answered as usual.

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
