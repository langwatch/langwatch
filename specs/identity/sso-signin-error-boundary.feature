Feature: What a failed single sign-on is allowed to say
  As somebody whose sign-in has just failed
  I need to be told something true and actionable about my sign-in
  So that I know whether to try again, use a different door, or ask an
  administrator - without being handed our internals to read

  # A sign-in that fails does not return a response. It REDIRECTS, and
  # whatever the failure carried travels in the query string of a page the
  # person is looking at, in a URL they can copy, paste into a ticket, and
  # keep in their history.
  #
  # `@better-auth/sso` throws `APIError`s carrying its own codes and internal
  # prose, and every one of them reached the browser verbatim. A real
  # sign-in failed with:
  #
  #   /auth/error?error=SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS
  #     &error_description=SSO+user+resolution+requires+a+database+adapter
  #     +with+native+transaction+support
  #
  # Three things are wrong with that, and only one is the wording. It names
  # an internal capability of our storage layer; it is useless to the person
  # reading it, who cannot act on it; and it appeared NOWHERE in our logs, so
  # the one copy of the cause was in somebody's address bar. The screen's own
  # default arm did its job - an unrecognised code renders generic copy and
  # is never echoed, because `?error=` is caller-controlled - but the code
  # and its description were still in the URL to be read.
  #
  # THE RULE, in one line: only a handled error crosses the boundary. A
  # refusal we have written down - one with a stable code a screen renders
  # copy for - travels as that code. Everything else becomes one generic
  # code, and the real cause is logged with a trace id instead. This is
  # ADR-045's rule applied to a redirect rather than a response body, and it
  # is the same rule the tRPC and REST boundaries already follow.
  #
  # Spec note: the sign-in error SCREEN's copy is covered by
  # specs/auth/sso-wrong-provider-recovery.feature and
  # specs/identity/signin-signup-screens.feature. This file is only about
  # what is allowed to reach it.

  @unit
  Scenario: A handled refusal crosses with its own code
    Given a sign-in refused with a handled error
    When the person is redirected to the sign-in error screen
    Then the address carries that refusal's stable code
    And the screen renders the copy written for it
    # These are the refusals somebody can act on - the wrong provider for
    # their domain, an organization that requires single sign-on, a link
    # needing approval. Losing them to a generic code would make every
    # failure look the same and strand people the screen could have helped.

  @unit
  Scenario: An unhandled failure crosses as one generic code
    Given a sign-in that failed for a reason we have not written down
    When the person is redirected to the sign-in error screen
    Then the address carries a single generic code
    And it carries no description of the internal failure
    And the screen says something went wrong signing them in

  @unit
  Scenario: An internal code never travels
    Given a sign-in refused with the plugin's native-transaction error
    When the person is redirected to the sign-in error screen
    Then the address does not carry that code
    And the address does not name a database, an adapter or a capability
    # The concrete failure this whole file was written for. Named as its own
    # scenario so that a later upgrade reintroducing the same class of error
    # fails here rather than in somebody's address bar.

  @unit
  Scenario: The cause is written down where we can read it
    Given a sign-in that failed for a reason we have not written down
    When the failure is turned into a redirect
    Then the real cause is logged with its trace id
    And the trace id is the one the screen can show
    # The half that was missing entirely. This failure produced no server log
    # line at all, so the only way to learn what had happened was to read the
    # URL off somebody's screen - which is why it survived from the day
    # single sign-on shipped.

  @unit
  Scenario: A description supplied by the caller is never echoed
    Given somebody opens the sign-in error screen with an error description of their own
    When the screen renders
    Then the supplied description is not shown
    # `?error_description=` is as caller-controlled as `?error=`, and the
    # screen already refuses to echo the second. Echoing the first would put
    # attacker-chosen prose under LangWatch branding just the same.
