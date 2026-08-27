Feature: The SCIM request log - what the provider asked, and what we answered
  As an administrator who has just pointed an identity provider at us
  I need to see the requests it made and what we said back
  So that "my provider says it is syncing and your page says no push yet"
  has an answer in the product rather than in our support queue

  # ADR-126. Deliberately a table and not an event: a request authors
  # nothing, so there is no fact to state, and rebuilding the world from the
  # log must not depend on how often a provider retried a GET. It is
  # evidence, it has a retention window, and nothing downstream derives from
  # it.
  #
  #   the provider sends a request
  #        │
  #        ├─ token does not verify ──► 401, and NO row: we cannot know whose
  #        │                            organization to file it under, and a
  #        │                            table unauthenticated traffic can
  #        │                            write is a table anyone can fill
  #        │
  #        ├─ token verifies, plan lapsed ──► 403, recorded: we recognize the
  #        │                                  credential, so it is attributable
  #        │
  #        └─ token verifies ──► handled, recorded with what we answered
  #
  # The unattributable case is the most common setup failure there is -- a
  # mistyped or stale token -- and it can never appear on the page of the
  # organization it was meant for. A SCIM token is an opaque value looked up
  # by hash: no prefix, no key id, nothing to resolve before the secret
  # matches. What answers it instead is the token's own row saying, in words,
  # that nothing has ever presented it.

  Background:
    Given an organization "acme" with an SSO connection "acme-okta" holding a directory token
    And "acme"'s administrator "ana" may manage single sign-on
    And a second organization "globex" with its own connection and token

  # ── What gets recorded ─────────────────────────────────────────────────

  @integration
  Scenario: A request the directory makes is recorded with what we answered
    When the directory creates a person over SCIM with "acme-okta"'s token
    Then the request is recorded against "acme-okta"
    And it carries when it arrived, what it asked for, and the status we answered

  @integration
  Scenario: A refusal we can attribute is recorded as a refusal
    Given "acme"'s plan no longer carries directory provisioning
    When the directory pushes with "acme-okta"'s token
    Then the request is recorded as refused
    And it carries a reason a customer can act on rather than an error code

  @integration
  Scenario: A request we cannot attribute is answered and not recorded
    When something pushes with a token nothing in the product issued
    Then it is refused
    And no request is recorded for anybody, because there is no anybody to record it for

  @integration
  Scenario: The log never carries the credential that was presented
    When the directory pushes with "acme-okta"'s token
    Then the recorded request carries no token, no hash of one, and no request header

  # ── Reading it ─────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: The requests a connection has served are on the SCIM settings page
    Given the directory has made several requests through "acme-okta"
    When "ana" opens the SCIM settings page
    Then she reads those requests, newest first

  @integration
  Scenario: Another organization's requests are not there to read
    Given the directory has made requests through "globex"'s connection
    When "ana" reads the requests for "acme"
    Then none of "globex"'s requests are listed

  @integration @unimplemented
  Scenario: Reading the requests takes seeing single sign-on, and writes nothing
    Given "acme" has a reader who may see single sign-on but not manage it
    When that reader opens the SCIM settings page
    Then they read the requests
    And they are offered no control that would change one

  # ── A token nothing has ever presented ─────────────────────────────────

  # The remedy for the case the log structurally cannot cover. It is the one
  # honest signal available, so it is said in words rather than left for the
  # reader to infer from an empty feed that would be empty for other reasons
  # too.
  @integration @unimplemented
  Scenario: A token nothing has presented says so, rather than only showing a date that is missing
    Given "acme" holds a token that has never verified
    When "ana" reads the provisioning tokens
    Then that token says nothing has ever presented it
    And the words point at the provider rather than at us

  # ── Retention ──────────────────────────────────────────────────────────

  @unit
  Scenario: Requests older than the window are dropped
    Given recorded requests older than the retention window
    When the retention sweep runs
    Then those requests are gone
    And requests inside the window are untouched

  @unit @unimplemented
  Scenario: An absent request is not evidence that it never happened
    Given a connection whose recorded requests have aged out
    When its requests are read
    Then the surface says what it holds rather than that nothing was ever sent
