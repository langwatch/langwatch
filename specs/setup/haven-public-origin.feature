Feature: haven public origin for tunneled access
  When a developer reaches a haven stack through a tunnel or SSH forward,
  they sign in from a public origin while the stack's services stay on the
  local network. LANGWATCH_HAVEN_PUBLIC_URL sets the public tunnel origin;
  the overlay carries it only on auth lines (BASE_HOST and NEXTAUTH_URL),
  leaving LANGWATCH_ENDPOINT pointing at the local stack.

  @unit
  Scenario: a tunneled stack signs in through its public origin
    Given a stack whose app URL is the local hostname
    When haven is started with LANGWATCH_HAVEN_PUBLIC_URL set to a tunnel origin
    Then the overlay's BASE_HOST is that public origin
    And the overlay's NEXTAUTH_URL is that public origin
    And LANGWATCH_ENDPOINT still points at the local app URL
    And LANGWATCH_ENDPOINT does not include the public origin

  @unit
  Scenario: LANGWATCH_HAVEN_PUBLIC_URL accepts only http and https schemes
    When LANGWATCH_HAVEN_PUBLIC_URL is unset
    Then the public URL is empty
    When LANGWATCH_HAVEN_PUBLIC_URL is set to https://tunnel.example.net/
    Then the public URL is trimmed to https://tunnel.example.net
    When LANGWATCH_HAVEN_PUBLIC_URL is set to http://tunnel.example.net
    Then the public URL is accepted
    When LANGWATCH_HAVEN_PUBLIC_URL is set to ftp://invalid.example.net
    Then the public URL is rejected with an invalid scheme
