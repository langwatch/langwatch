Feature: Claiming an ephemeral account — CLI, or a PKCE handoff to the browser
  As a developer whose agent provisioned a temporary account for me
  I want to attach my identity to it before it is deleted
  So that I keep the traces I already collected, and the key my agent is
  using keeps working.

  Two entrances. A CLI that already has an identity claims directly. A CLI
  that does not starts a handoff: it prints a URL, opens it, and polls while
  the human signs in and approves in the browser. The handoff is PKCE, so the
  code in the URL is useless to anyone who did not start it.

  The claim never reissues the ingestion key. The agent is mid-session with
  that key exported into its environment; rotating it on claim would break the
  session the claim is meant to rescue.

  Pairs with:
    - specs/ai-governance/agent-onboarding/provisioning.feature
    - specs/ai-governance/agent-onboarding/lifecycle.feature
    - specs/ai-governance/cli-onboarding/login-unified.feature
    - src/server/routes/auth-cli.ts   (the device flow this mirrors)

  Background:
    Given an ephemeral account provisioned 2 days ago
    And the CLI holds its claim token

  # ─────────────────────────────────────────────────────────────────────
  # Direct claim — the CLI already has an identity
  # ─────────────────────────────────────────────────────────────────────

  @bdd @claim @unit
  Scenario: a logged-in CLI claims without opening a browser
    Given the CLI has a valid device session
    When it POSTs the claim token to `/claim/direct`
    Then the caller becomes an owner of the ephemeral organization
    And the placeholder that owned it is retired
    And the account is marked claimed
    And no browser is opened

  @bdd @claim @unit
  Scenario: claiming as the placeholder itself promotes it in place
    Given the claimer proved they own the placeholder
    When they claim
    Then the placeholder stops being unclaimed
    And no ownership changes hands
    # the passkey path: the credential was enrolled against the placeholder,
    # so the organization was already theirs and there is never a window with
    # two admins or none.

  @bdd @claim @unit
  Scenario: claiming keeps the ingestion key exactly as it was
    When the account is claimed
    Then the ingestion key is unchanged
    And the project id is unchanged
    And traces already ingested stay where they are
    # the agent's OTEL_* config was written on day 0 and nobody is going to
    # rewrite it mid-session.

  @bdd @claim @unit
  Scenario: claiming cancels the reaper
    When the account is claimed
    Then `deleteAfter` is cleared
    And `ingestionStopsAt` is cleared
    And the account no longer appears in the reaper's work list

  # @unimplemented: route-level auth middleware; needs the mounted service, not the domain
  @bdd @claim @unit @unimplemented
  Scenario: an unauthenticated direct claim is refused
    Given the CLI has no device session
    When it POSTs the claim token to `/claim/direct`
    Then the response is 401
    And the message points at the handoff flow

  # ─────────────────────────────────────────────────────────────────────
  # PKCE handoff — the CLI has no identity
  # ─────────────────────────────────────────────────────────────────────

  @bdd @claim @pkce @unit
  Scenario: starting a handoff returns a URL the CLI can open
    Given the CLI generated a code verifier and its S256 challenge
    When it POSTs the claim token and the challenge to `/claim/handoff`
    Then the response carries a handoff code
    And the response carries the URL to open in a browser
    And the response carries the poll interval the CLI must honour
    And the response carries the handoff's own expiry

  @bdd @claim @pkce @unit
  Scenario: only S256 is accepted
    When the CLI starts a handoff with challenge method `plain`
    Then the response is 422
    # `plain` puts the verifier in the URL, which defeats the point.

  @bdd @claim @pkce @unit
  Scenario: the browser page can describe what is about to be claimed
    Given a handoff is in progress
    When the signed-in website GETs `/claim/handoff/{code}`
    Then it receives the project name, when it was provisioned, and the deadline
    And it does not receive the claim token
    And it does not receive the ingestion key
    # the page has to explain the handoff to a human, and that is all it
    # needs to do it.

  @bdd @claim @pkce @unit
  Scenario: approving in the browser attaches the signed-in identity
    Given a handoff is in progress
    And a user is signed in to the website
    When they approve at `/claim/handoff/{code}/approve`
    Then that user becomes an owner of the ephemeral organization
    And the handoff is marked approved

  # @unimplemented: route-level session middleware; needs the mounted service
  @bdd @claim @pkce @unit @unimplemented
  Scenario: approving requires a signed-in user
    Given a handoff is in progress
    When an anonymous visitor posts the approval
    Then the response is 401
    And the handoff stays pending

  @bdd @claim @pkce @unit
  Scenario: the CLI's poll returns pending until the human approves
    Given a handoff is in progress and not yet approved
    When the CLI POSTs to `/claim/exchange` with the handoff code and verifier
    Then the response says pending
    And it repeats the poll interval

  @bdd @claim @pkce @unit
  Scenario: the CLI's poll succeeds once approved
    Given the human approved in the browser
    When the CLI polls `/claim/exchange` with the correct verifier
    Then the response says approved
    And it carries the organization id and project id
    And the account is marked claimed

  @bdd @claim @pkce @security @unit
  Scenario: a stolen handoff code is useless without the verifier
    Given an attacker observed the handoff code in the URL
    When they poll `/claim/exchange` with a verifier they made up
    Then the response is 400
    And the handoff is not consumed by the failed attempt
    # PKCE is the whole reason the code can safely ride in a URL that gets
    # pasted into chat, shoulder-surfed, or logged by a browser.

  @bdd @claim @pkce @security @unit
  Scenario: the verifier is checked by hashing, never by storing it
    Then only the challenge is persisted for the handoff
    And the verifier is never stored server-side

  @bdd @claim @pkce @unit
  Scenario: a handoff code is single-use
    Given a handoff was exchanged successfully
    When the CLI polls `/claim/exchange` again with the same code
    Then the response is 410

  @bdd @claim @pkce @unit
  Scenario: a handoff expires long before the account does
    Given a handoff was started 20 minutes ago
    When the CLI polls `/claim/exchange`
    Then the response is 410
    And starting a fresh handoff still works
    # the handoff is a browser round-trip, not a grace period; the 30-day
    # window belongs to the claim token, not to this code.

  # ─────────────────────────────────────────────────────────────────────
  # Claiming twice, and claiming late
  # ─────────────────────────────────────────────────────────────────────

  @bdd @claim @unit
  Scenario: claiming an already-claimed account is refused, not silently re-run
    Given the account was claimed yesterday
    When a second caller claims it with the same token
    Then the response is 409 with code `ephemeral_account_already_claimed`
    And ownership does not change

  @bdd @claim @unit
  Scenario: a claim after the deletion deadline is refused
    Given the account passed its `deleteAfter`
    When the CLI claims it
    Then the response is 410
    And the message says the data is gone

  @bdd @claim @unit
  Scenario: a claim during the read-only window still works
    Given the account passed `ingestionStopsAt` but not `deleteAfter`
    When the CLI claims it
    Then the claim succeeds
    And ingestion resumes
    # day 7 to day 30 is exactly the window the claim exists to rescue.

  # @unimplemented: the reaper is not built yet; the conditional UPDATE that decides the race is covered by the double-claim tests
  @bdd @claim @race @unit @unimplemented
  Scenario: a claim landing at the same moment as the reaper resolves for the claim
    Given the reaper has selected the account for deletion
    When a claim commits before the delete
    Then the account is claimed
    And the reaper skips it
