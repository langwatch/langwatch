Feature: Signed-out authentication limits count the caller, not the hop in front of it
  As an operator running LangWatch behind a proxy
  I want every entrance a signed-out visitor can reach to count the same caller
  So that no visitor is limited for somebody else's traffic, and no attacker
  gets an unlimited entrance because one of them counts differently

  # The entrances a visitor reaches before signing in each carry a small budget
  # per caller: asking where an address should sign in, asking for a sign-up
  # confirmation, opening an invitation, asking for a fresh invitation, and
  # registering an account. The budgets are small on purpose, which is exactly
  # what makes WHO they are spent against load-bearing — behind a proxy, an
  # entrance that counts the hop instead of the visitor either caps the whole
  # installation or counts an attacker's every request as somebody else's.
  #
  # How a caller is resolved from a request, and why a forwarding header from an
  # undeclared peer is ignored, is specs/identity/signin-router.feature's
  # ("Auth throttles distinguish callers behind a trusted ingress" and the two
  # scenarios beside it). This is the other half: that every entrance asks, and
  # that they all ask the same thing.

  @unit
  Scenario: Every public auth entrance resolves its caller the same way
    Given a deployment whose entrances are reachable before signing in
    When each of those entrances decides whose budget a request spends
    Then every one of them resolves the caller the way the deployment is configured to
    And not one of them counts the connection it arrived on instead, which behind a proxy is the proxy
