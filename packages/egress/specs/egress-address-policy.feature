Feature: Egress address policy and the pinned fetch
  As LangWatch sending requests to destinations a user supplied
  I want every connection made only to an address the policy has judged
  So that a destination reaches what it named and nothing the policy refuses

  @unit
  Scenario: A hostname that resolves to a cloud metadata address is refused
    Given a policy that allows local addresses
    When a destination's hostname resolves to a cloud metadata address
    Then the destination is refused

  @unit
  Scenario: An allowlisted hostname is still resolved, checked and pinned
    Given a policy that allowlists a hostname
    When that hostname resolves to an ordinary address
    Then the destination is admitted and pinned to that address
    When that hostname resolves to a cloud metadata address
    Then the destination is refused

  @unit
  Scenario: A fully-qualified hostname with a trailing dot is judged as the same name
    When a destination names a hostname with one trailing dot
    Then it is judged exactly as the hostname without the dot

  @unit
  Scenario: Every spelling of a metadata address classifies as metadata
    When an address is any listed cloud metadata address, or one written inside an IPv6 address
    Then it classifies as a cloud metadata address

  @unit
  Scenario: A destination the validator could not resolve is checked when it connects
    Given a destination admitted without a resolved address
    When its hostname resolves to a cloud metadata address at connect time
    Then the request fails without connecting
    When its hostname resolves to an ordinary address at connect time
    Then the request is sent

  @unit
  Scenario: A redirect to another origin does not carry credentials
    Given a request carrying an Authorization header and a cookie
    When the receiver redirects to a different origin
    Then the next hop is sent without them
    When the receiver redirects within the same origin
    Then the next hop keeps them

  # Behind a corporate proxy the only way out is the proxy: a socket pinned to
  # the judged address never leaves the network. The policy still judges every
  # hop first; the proxy only decides how an admitted request travels.

  @unit
  Scenario: An admitted destination leaves through the configured outbound proxy
    Given an outbound proxy is configured
    When a destination the policy admitted is fetched
    Then the request is sent through the proxy, not to the judged address

  @unit
  Scenario: A destination the proxy exclusions name is reached directly
    Given an outbound proxy is configured and NO_PROXY names a destination's host
    When that destination is fetched
    Then the request is sent to the judged address, without the proxy

  @unit
  Scenario: A redirect is judged again before it travels through the proxy
    Given an outbound proxy is configured
    When the receiver redirects to a destination the policy refuses
    Then the next hop is refused without being sent to the proxy

  @unit
  Scenario: A hop the caller routes around the proxy is reached directly
    Given an outbound proxy is configured
    And the caller routes a destination's hop around the proxy
    When that destination is fetched
    Then the request is sent to the judged address, without the proxy

  @unit
  Scenario: A malformed proxy setting fails as a proxy configuration error
    Given the outbound proxy setting is not a URL
    When a destination the policy admitted is fetched
    Then the fetch fails with an error naming the proxy setting, not the destination
    And the error does not repeat the setting's value

  # Every caller opts in by passing its proxy setting (ADR-187). These have not yet.
  @integration @unimplemented
  Scenario Outline: A caller that fetches a user-supplied address passes the outbound proxy
    Given an outbound proxy is configured
    When <caller> fetches a destination the policy admitted
    Then the request leaves through the proxy

    Examples:
      | caller                            |
      | a webhook destination             |
      | a model provider credential check |
      | a web push subscription           |
      | an external image                 |
