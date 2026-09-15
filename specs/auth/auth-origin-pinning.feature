Feature: Only this installation's own pages may change who is signed in
  As somebody signed in to LangWatch
  I want another site to be unable to act on my account through my browser
  So that opening a page somewhere else cannot sign me in, sign me out, or
  attach a way into my account

  # Every call that CHANGES authentication state — signing in, signing out,
  # registering a way in, spending a proof — has to show that it came from this
  # installation's own pages. A browser volunteers that on every such call: it
  # names the site the page is served from, or the page itself. A call that
  # names another site is somebody else's page acting through a browser that
  # happens to be signed in here, and it is refused before anything is read or
  # written.
  #
  # The address checked against is the one the installation is configured to
  # live at. specs/auth/dev-port-origin-alignment.feature owns the other half
  # of that: a developer's checkout on a second port is this installation, and
  # must not be refused as though it were another site.

  Rule: A call that changes authentication state proves where it came from

    @unit
    Scenario: A request from this installation's own pages is allowed through
      Given a browser on a page this installation served
      When it submits a call that changes who is signed in
      Then the call is handled
      And which page of ours it came from makes no difference, only that it is ours

    @unit
    Scenario: A state-changing auth request from another site is refused
      Given a browser holding a session here
      When a page on another site makes it submit a call that changes who is signed in
      Then the call is refused and nothing about the session changes
      And a neighbouring subdomain, a different port, and a different scheme are each another site
      And it makes no difference whether that site is named as the origin or as the page the call came from

    @unit
    Scenario: A request that proves no origin at all is refused
      Given a call that changes who is signed in
      When it names neither the site it came from nor the page it came from
      Then the call is refused
      And a name we cannot read is no name at all, so it is refused the same way
      # A browser always volunteers one of the two on such a call. Something
      # that volunteers neither is not the browser we are protecting.

    @unit
    Scenario: A browser that names only the page it came from is still recognised
      Given a browser that names the page it came from rather than the site
      When it submits a call that changes who is signed in
      Then the page's own site is what the call is judged on
      And the call is handled when that site is ours

    # Fail closed, not open. If the installation's own address is unreadable we
    # cannot tell our pages from anybody else's, and the safe answer to "is
    # this ours?" with no way to know is no. Signing in stops working, which is
    # loud, reported, and fixed by correcting the address — where the other
    # choice is an installation that quietly accepts anybody's page.
    @unit
    Scenario: A misconfigured own address refuses every state-changing request rather than none
      Given the address this installation is configured to live at cannot be read
      When any call that changes who is signed in arrives
      Then every one of them is refused, whoever sent it

    @integration
    Scenario: A cross-site sign-in post reaches no further than the refusal
      Given the application is running
      When a sign-in is posted from another site
      Then the refusal is the answer, and no credential is ever checked
      And no session is handed back

  Rule: A call that only reads is never judged on where it came from

    # Reading cannot change anything, and the gate above would break the
    # ordinary web if it applied here: a browser asks permission before some
    # cross-site calls, and refusing that question refuses the call it was
    # asking about.
    @unit
    Scenario: Reading authentication state is never refused for where it came from
      When a call that only reads arrives, or a browser asks permission for one
      Then it is handled whatever site it names
      And it is still handled when this installation's own address cannot be read
