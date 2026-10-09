Feature: Workspace resolution
  As somebody opening LangWatch on a project address
  I want the app to wait until it knows my workspace
  So that it is never told my project or my organization does not exist

  Resolving a workspace takes two reads, in order: the session, and then the
  organization graph that session is allowed to see. Between them the graph
  read is switched OFF — it has nothing to ask for yet — and a switched-off
  read is not a read that answered with nothing. React Query reports a
  disabled query as "not loading" with no data, which is the same shape as
  "answered, and there was nothing there".

  Both readings of that shape are destructive. The project chrome draws its
  full-page not-found scene for any address naming a project it cannot find,
  so a member refreshing a project page watched a 404 for the width of the
  session fetch. The landing redirect reads an empty graph as an account with
  no organization and answers with onboarding, so "/" bounced a member
  through /onboarding/welcome before correcting itself.

  So: callers are told the workspace is still resolving for the whole gap,
  and having no organization is only ever something the graph SAID, never
  something inferred from its silence.

  A refusal is the third answer, and it is silent in the same way — a read
  that failed leaves the same absent list behind it as a read still in
  flight. Nobody is sent to onboarding on it. The landing address has no
  home to fall back to when it lands, so it is the one screen that has to
  say the read failed rather than keep waiting on it.

  @integration
  Scenario: The workspace is still resolving while the session is
    Given my session has not resolved yet
    When a screen asks for my workspace
    Then it is told the workspace is still resolving

  @integration
  Scenario: The workspace is still resolving while the organization graph is read
    Given my session has resolved
    And the organization graph has not answered yet
    When a screen asks for my workspace
    Then it is told the workspace is still resolving

  @integration
  Scenario: A workspace whose graph has answered has resolved
    Given my session has resolved
    And the organization graph has answered
    When a screen asks for my workspace
    Then it is told the workspace has resolved

  @integration
  Scenario: An address anybody can open resolves without waiting for a graph
    Given I am on an address anybody can open
    And my session has resolved to nobody
    When a screen asks for my workspace
    Then it is told the workspace has resolved

  @integration
  Scenario: An address anybody can open does not wait for the session either
    Given I am on an address anybody can open
    And my session has not resolved yet
    When a screen asks for my workspace
    Then it is told the workspace has resolved

  @integration
  Scenario: A graph that refused the read is not a graph still reading
    Given my session has resolved
    And the organization graph refused the read
    When a screen asks for my workspace
    Then it is told the read was refused

  @integration
  Scenario: The landing address says a refused read failed rather than waiting on it
    Given the organization graph refused the read
    When I open the landing address
    Then I am shown that my workspace could not be opened
    And I am not left watching a loading screen

  @unit
  Scenario: Belonging to no organization is something the graph said
    Given the organization graph answered with no organizations
    When the landing redirect asks whether I belong anywhere
    Then the answer is that I belong to no organization

  @unit
  Scenario: A graph that never answered is not an account without organizations
    Given the organization graph has not answered
    When the landing redirect asks whether I belong anywhere
    Then the answer is that this is not yet known
