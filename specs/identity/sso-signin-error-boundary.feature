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
  Scenario: The logged cause names the provider's code
    Given a sign-in that failed with a provider code we have not written down
    When the failure is logged
    Then the record's cause is a sign-in refusal carrying that code

  @unit
  Scenario: A description supplied by the caller is never echoed
    Given somebody opens the sign-in error screen with an error description of their own
    When the screen renders
    Then the supplied description is not shown
    # `?error_description=` is as caller-controlled as `?error=`, and the
    # screen already refuses to echo the second. Echoing the first would put
    # attacker-chosen prose under LangWatch branding just the same.

  # A sign-in callback is opened by the browser, not by code, so a server
  # error there must land on the sign-in error screen rather than a blank
  # page. Other auth routes are called by the app and API clients, which read
  # the status, so they keep their 5xx.
  @unit
  Scenario: A sign-in callback that fails on the server lands on the error screen
    Given a sign-in callback from an identity provider fails with a server error
    When the person's browser receives the answer
    Then they are redirected to the sign-in error screen with the generic code
    And the trace id travels with it and the cause is logged

  @unit
  Scenario: A server error on an auth route that is not a callback keeps its status
    Given an auth request that is not a sign-in callback fails with a server error
    When the caller receives the answer
    Then it is the server error itself, not a redirect

  # better-auth answers `state_mismatch` when the sign-in's state cookie does
  # not match the state the provider returned: the attempt expired, or it was
  # started in another tab or browser. The cause is known and the person can
  # act on it, so it is not an unknown failure to log as one.
  @unit
  Scenario: A sign-in that expired or started elsewhere crosses with its own code
    Given a provider sign-in whose state no longer matches this browser
    When the person is sent to the sign-in error screen
    Then the code crosses as itself, and the cause is not logged as an unknown failure
    And the screen says the sign-in expired or was started in another tab or browser
    And it offers to start again from the sign-in page

  # An identity provider answers `access_denied` when it turns the person away, e.g. Microsoft
  # Entra ID AADSTS50105 ("User is not assigned to the client application") when the enterprise
  # app requires assignment, and also when the person cancels a consent screen. Neither is a
  # fault of ours, so it neither becomes the generic code nor pages on-call. The provider's
  # description is neither logged nor left in the address bar. The same code arrives from social
  # and SSO providers alike, so the screen's advice about an IT administrator is conditional.
  @unit
  Scenario: A provider's access_denied refusal crosses and is logged as a warning
    Given a provider sign-in that the identity provider refuses with "access_denied"
    When the person is sent to the sign-in error screen
    Then the code crosses as itself
    And the refusal is logged at warn with its reference, not at error
    And the provider's description is neither logged nor kept on the redirect
    And the screen says their company sign-in refused it, not LangWatch
    And it tells them their IT team can assign them the LangWatch app, or to try again if they cancelled
    # What the refusal names and when it becomes a seat limit: specs/identity/idp-refused-sign-in.feature

  @unit @regression
  Scenario: A sign-in that succeeds is not read as a failure
    Given a person who is signed in, or whose provider account is already linked, signs in
    When the callback redirects without an error code
    Then no error code is read and the redirect passes through unchanged

  # Better Auth redirects a refused link with its own codes. Each one a person can act on is
  # folded to the screen code that has words for it; every other one is classified as having no
  # specific screen, so it crosses as the generic code above.
  @unit @regression
  Scenario: The native account-link refusal maps to a stable sign-in error
    When the authentication library reports that the account is not linked
    Then the error is treated as OAuthAccountNotLinked
    And it is classified as a stable sign-in error

  @unit @regression
  Scenario: The different-email refusal shows the specific message
    When the authentication library reports "email_does_not_match"
    Then the error is treated as DIFFERENT_EMAIL_NOT_ALLOWED

  @unit @regression
  Scenario: The earlier library's different-email spelling still shows the specific message
    When a sign-in link from the earlier library release reports "email_doesn't_match"
    Then the error is treated as DIFFERENT_EMAIL_NOT_ALLOWED

  @unit @regression
  Scenario: Every link refusal the installed library redirects with has a specific screen code
    Given the callback error codes and sign-in result codes the installed authentication library defines
    Then email_does_not_match is treated as DIFFERENT_EMAIL_NOT_ALLOWED
    And account_already_linked_to_different_user is treated as ACCOUNT_LINKED_TO_ANOTHER_USER
    And the refusal for an existing account under another method is treated as OAuthAccountNotLinked
    And every other code read is classified as having no specific screen

  # Linking from Settings > Security with a provider account another LangWatch user already holds
  # is not the wrong-method sign-in: the person is signed in, and signing out or connecting the
  # method in Settings is exactly what just failed. It needs its own code and its own words.
  @unit @regression
  Scenario: A provider account already linked to another user crosses with its own code
    When the authentication library reports "account_already_linked_to_different_user"
    Then the error is treated as ACCOUNT_LINKED_TO_ANOTHER_USER, not OAuthAccountNotLinked
    And it is classified as a stable sign-in error, so it may cross to the screen

  @unit @regression
  Scenario: An upgrade that adds or renames a library code fails until the code is classified
    Given the sign-in library redirects with a set of error codes
    When an upgrade adds or renames one of them
    Then the upgrade cannot merge until that code is classified

  @unit @regression
  Scenario: The SSO plugin's spaced account-link spelling still shows the account-link message
    When the SSO plugin's OIDC callback reports "account not linked"
    Then the error is treated as OAuthAccountNotLinked

  @unit @regression
  Scenario: A bookmarked error address with a retired spelling shows the generic error
    When an error address carries "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED"
    Then the code is not one of ours to hand to somebody, so it is withheld

  @unit @regression
  Scenario: The organization's sign-in cutover codes are unchanged
    When any cutover sign-in error code is read
    Then it is returned as itself and is classified as a stable sign-in error
