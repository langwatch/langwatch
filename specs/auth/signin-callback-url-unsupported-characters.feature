Feature: Signing in returns people to pages whose address better-auth would refuse
  As somebody asked to sign in while looking at a page
  I want to land back on that page once I am signed in
  So that a page with an unusual address does not make sign-in impossible

  # better-auth refuses a relative return address unless it is made of
  # letters, digits and a few punctuation marks. Agent-testing
  # results carry a colon in their address, and fragments, tildes, commas and
  # percent signs are refused too. Refused, the sign-in fails every time.
  #
  # For a provider sign-in, such an address is kept in the browser tab instead,
  # better-auth is handed a resume page it always accepts, and the resume page
  # continues to the kept address. A password sign-in never leaves the page's
  # own script, so it hands better-auth nothing and navigates there itself.

  @unit
  Scenario: A password sign-in from a page with a colon in its address lands back on that page
    Given somebody on an agent-testing results page whose address has a colon
    When they sign in with their password
    Then the sign-in is accepted
    And they land on the results page they started from

  @unit
  Scenario: A password sign-in from a page better-auth accepts hands it over unchanged
    Given a page whose address better-auth accepts
    When somebody signs in with their password
    Then better-auth is handed that address as it is
    And they land on that page

  @unit
  Scenario: A password sign-in never navigates off the site
    Given a return address that is the same site on paper but reads as another site once cleaned up
    When somebody signs in with their password
    Then they land on the home page

  @unit
  Scenario: An abandoned provider sign-in leaves nothing behind for the next one
    Given somebody started a provider sign-in from a page better-auth refuses and abandoned it
    When they sign in through a provider from a page better-auth accepts
    Then nothing is kept for the resume page

  @unit
  Scenario: A provider sign-in from a page with a colon in its address resumes there
    Given somebody on an agent-testing results page whose address has a colon
    When they sign in through a social provider or their organization's connection
    Then the provider returns them to the resume page
    And the resume page continues to the results page they started from

  @unit
  Scenario: Addresses better-auth refuses are carried through the resume page
    Given a page whose address has a colon, a fragment, a tilde or a comma
    When somebody signs in from it
    Then better-auth is handed the resume page, or nothing for a password sign-in
    And the resume page continues to that address once, and only once

  @unit
  Scenario: An address better-auth already accepts is handed over unchanged
    Given a page whose address better-auth accepts
    When somebody signs in from it
    Then better-auth is handed that address as it is
    And nothing is kept for the resume page

  @unit
  Scenario: A parked destination on another site falls back to the home page
    Given the address kept for the resume page points at another site
    When the resume page continues
    Then it goes to the home page instead

  @integration
  Scenario: The resume page forwards once to the parked page
    Given the address kept for the resume page is a page with a colon in its address
    When the resume page opens, even when it renders twice
    Then it goes to that page exactly once
    And nothing is kept for the resume page
