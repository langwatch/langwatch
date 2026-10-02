Feature: Egress address policy and the pinned fetch
  As LangWatch sending requests to destinations a user supplied
  I want every connection made only to an address the policy has judged
  So that a destination reaches what it named and nothing the policy refuses

  Scenario: A hostname that resolves to a cloud metadata address is refused
    Given a policy that allows local addresses
    When a destination's hostname resolves to a cloud metadata address
    Then the destination is refused

  Scenario: An allowlisted hostname is still resolved, checked and pinned
    Given a policy that allowlists a hostname
    When that hostname resolves to an ordinary address
    Then the destination is admitted and pinned to that address
    When that hostname resolves to a cloud metadata address
    Then the destination is refused

  Scenario: A fully-qualified hostname with a trailing dot is judged as the same name
    When a destination names a hostname with one trailing dot
    Then it is judged exactly as the hostname without the dot

  Scenario: Every spelling of a metadata address classifies as metadata
    When an address is any listed cloud metadata address, or one written inside an IPv6 address
    Then it classifies as a cloud metadata address

  Scenario: A destination the validator could not resolve is checked when it connects
    Given a destination admitted without a resolved address
    When its hostname resolves to a cloud metadata address at connect time
    Then the request fails without connecting
    When its hostname resolves to an ordinary address at connect time
    Then the request is sent

  Scenario: A redirect to another origin does not carry credentials
    Given a request carrying an Authorization header and a cookie
    When the receiver redirects to a different origin
    Then the next hop is sent without them
    When the receiver redirects within the same origin
    Then the next hop keeps them
