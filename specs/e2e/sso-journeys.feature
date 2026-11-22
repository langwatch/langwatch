@e2e
Feature: Enterprise sign-on journeys against the identity-provider simulator
  As an organisation administrator
  I want my people to sign in through our own identity provider
  So that access to LangWatch follows our directory

  The journeys run a real stack in a named deployment mode against idpsim.
  Each journey registers its own application at the simulator, so client
  secret and redirect enforcement stay on, and uses its own domain, so runs
  on a long-lived stack never collide. Sessions survive unless a step says
  otherwise.

  Background:
    Given the stack runs the deployment mode the journey names
    And an administrator with a confirmed local account owns an organisation
    And the administrator's address is a directory user at the simulator

  # S01
  @saas
  Scenario: A member signs in through the organisation's OIDC connection
    Given the organisation registered an OIDC connection with the simulator's issuer, client id and secret
    And the organisation proved its domain with a DNS TXT record
    And the connection went live
    When a directory user at that domain enters their address on the sign-in screen
    Then they are sent to the simulator and back without a second prompt
    And they are signed in as that address
    And the simulator recorded a token exchange for the organisation's client

  # S02
  @saas
  Scenario: A member signs in through the organisation's SAML connection
    Given the organisation registered a SAML connection from the simulator's metadata
    And the organisation proved its domain with a DNS TXT record
    And the connection went live
    When a directory user at that domain enters their address on the sign-in screen
    Then they are signed in as that address
    And the simulator recorded an assertion for that user

  # S05
  @saas
  Scenario: A connection goes from registration to live to teardown
    Given the organisation registered an OIDC connection
    When the administrator proves the domain, completes a test sign-in, names a break-glass account, decides arrivals and activates it
    Then the connection is active
    When the administrator removes the connection
    Then the connection is no longer active

  # S07
  @saas
  Scenario: A first sign-in creates the user and their membership
    Given the organisation's OIDC connection is live and admits arrivals
    And a directory user at that domain has never signed in to LangWatch
    When that user signs in through the connection
    Then a LangWatch user exists for that address
    And that user is a member of the organisation

  # S10
  @saas
  Scenario: A confirmed local account is linked rather than duplicated
    Given a confirmed local account at the organisation's domain
    And the organisation's OIDC connection is live
    When the owner of that account signs in through the connection
    Then they are signed in as the same LangWatch user, not a new one

  # S16
  @saas
  Scenario: On the hosted product the licence gate leaves sign-on available
    Given the stack runs the hosted product with no licence configured
    When the administrator registers an OIDC connection
    Then the registration is accepted

  # S16, S01, S05 refusal
  @sh-free
  Scenario: Without a licence a self-hosted stack refuses to register a connection
    Given the stack runs self-hosted with no licence
    When the administrator registers an OIDC connection
    Then the registration is refused with a client error, not a server error
    And no sign-in reached the simulator for that connection's client
