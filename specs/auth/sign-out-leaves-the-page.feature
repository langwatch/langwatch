Feature: Signing out leaves the page

  Clicking Logout has to end two things: the session on the server, and the
  page the reader is looking at. Ending only the first leaves a signed-out
  reader sitting on a screen full of a tenant's data, apparently still signed
  in, until something makes them reload. The session read is held for the
  life of the document (`staleTime: Infinity`, no refetch on focus), so
  nothing will make them reload on its own.

  So sign-out is a full-page departure for `GET /api/auth/logout`, not a
  background `POST /sign-out`. That route is also the only one that federates
  the logout out to the deployment's identity provider: on an SSO deployment
  a cleared cookie here means nothing while the provider's own session still
  stands, because the next sign-in attempt is waved straight back through.

  Everything this device remembered about the reader goes before the tab
  leaves, not after: once the next document is loading, nothing of ours is
  running to do it. The mirrored reads in IndexedDB are cleared and awaited;
  the local and session stores are cleared outright
  (`specs/ui/browser-global-store.feature`).

  @unit
  Scenario: Signing out takes the reader off the page they were on
    Given a signed-in reader on an application page
    When they sign out
    Then the tab is leaving for another document
    And the reader is not left on the page they were signed in on

  @unit
  Scenario: Signing out leaves by the route that ends a federated session too
    Given a signed-in reader on an application page
    When they sign out
    Then the tab leaves for the logout route, which federates to the identity provider
    And nothing is signed out by a background request that leaves the page standing

  @unit
  Scenario: Signing out forgets this device's memory of the reader before leaving
    Given a reader whose preferences and mirrored reads are kept on this device
    When they sign out
    Then every remembered preference is gone before the tab leaves
    And every mirrored read is gone before the tab leaves

  @unit
  Scenario: A screen's sign-out control ends the session through the one owner of sign-out
    Given a screen that offers its own sign-out control
    When the reader uses it
    Then it asks the session host service to sign out
    And it does not navigate to the logout route by hand
