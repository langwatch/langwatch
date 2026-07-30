Feature: Anonymous agent onboarding — provision an ephemeral, claimable account
  As a developer (or the coding agent driving my terminal)
  I want `npx langwatch claude` to get me a working ingestion key with no signup
  So that traces start flowing in the first minute, and I decide later whether
  to keep the account.

  The whole point is zero-auth: an agent cannot fill in a signup form, cannot
  open a browser and cannot pay, so the front door must mint a usable account
  from an unauthenticated POST. Everything that makes that safe lives in
  rate-limiting.feature (abuse) and lifecycle.feature (the reaper).

  Pairs with:
    - specs/ai-governance/agent-onboarding/claim-handoff.feature
    - specs/ai-governance/agent-onboarding/rate-limiting.feature
    - specs/ai-governance/agent-onboarding/lifecycle.feature
    - specs/ai-governance/cli-onboarding/login-unified.feature  (the identity path)

  Background:
    Given the RPC service is mounted at `/api/agent-onboarding`
    And the caller has no session, no API key and no LangWatch account

  # ─────────────────────────────────────────────────────────────────────
  # The happy path
  # ─────────────────────────────────────────────────────────────────────

  @bdd @provisioning
  Scenario: provisioning mints an org, a project and an ingestion-only key
    When the caller POSTs to `/provision` with agent `claude_code`
    Then the response is 201
    And an organization, a team and a project are created
    And the response carries the project id and the project slug
    And the response carries an ingestion key
    And the response carries a claim token
    And the response carries the OTLP endpoint the agent should export to

  @bdd @provisioning @security
  Scenario: the minted key can only write traces, never read them
    When the caller POSTs to `/provision`
    Then the minted key is an ingestion key with the `ik-lw-` prefix
    And its only permission is `traces:create`
    And its role binding is PROJECT-scoped to the new project
    And reading traces with that key is refused

  # an ingestion-only key is the entire security story for the anonymous
  # path — the key is handed to an agent and lands in its transcript, so it
  # must be worthless for reading anyone's data, including its own.

  @bdd @provisioning
  Scenario: the response states both lifecycle deadlines
    When the caller POSTs to `/provision`
    Then the response carries `ingestionStopsAt` 7 days out
    And the response carries `deleteAfter` 30 days out
    And both are absolute timestamps, not durations
    # absolute, because the CLI persists them to a global config and reads
    # them back days later — a relative "7 days" would be wrong on read.

  @bdd @provisioning
  Scenario: the claim token is returned exactly once
    When the caller POSTs to `/provision`
    Then the plaintext claim token appears in the response body
    And only a hash of it is persisted
    And no later endpoint can reproduce the plaintext

  @bdd @provisioning
  Scenario: the agent slug is recorded as ingestion provenance
    When the caller POSTs to `/provision` with agent `<agent>`
    Then the ingestion key is stamped with source type `<agent>`

    Examples:
      | agent       |
      | claude_code |
      | codex       |
      | gemini      |
      | opencode    |

  @bdd @provisioning @validation
  Scenario: an unknown agent slug is rejected rather than silently stored
    When the caller POSTs to `/provision` with agent `not_a_real_agent`
    Then the response is 422 with code `validation_error`

  # ─────────────────────────────────────────────────────────────────────
  # No identity anywhere in the anonymous path
  # ─────────────────────────────────────────────────────────────────────

  @bdd @provisioning @privacy
  Scenario: provisioning collects no email, no name and no password
    When the caller POSTs to `/provision`
    Then the request schema has no email field
    And the created organization has no members
    And nothing in the flow sends an email

  @bdd @provisioning @privacy
  Scenario: the client fingerprint is peppered before it is stored
    Given the caller sends a device fingerprint
    When the caller POSTs to `/provision`
    Then only an HMAC of the fingerprint is persisted
    And the raw fingerprint is never written to the database or the logs

  @bdd @provisioning @privacy
  Scenario: the provisioning IP is peppered before it is stored
    When the caller POSTs to `/provision`
    Then only an HMAC of the IP is persisted
    And the raw IP is never written to the ephemeral-account row

  # the pepper means a database dump cannot be reversed into "which IPs
  # tried LangWatch", while equality checks for abuse still work.

  @bdd @provisioning
  Scenario: a missing fingerprint is allowed, and is not treated as a shared one
    Given the caller sends no fingerprint
    When the caller POSTs to `/provision`
    Then provisioning succeeds
    And the row records no fingerprint
    And the absent fingerprint does not collide with any other caller's bucket
    # an empty-string fingerprint hashing to one shared bucket would rate-limit
    # every fingerprint-less caller against every other one.

  # ─────────────────────────────────────────────────────────────────────
  # Failure modes
  # ─────────────────────────────────────────────────────────────────────

  @bdd @provisioning @errors
  Scenario: a failed key mint leaves no half-built account behind
    Given issuing the ingestion key fails
    When the caller POSTs to `/provision`
    Then the organization, team and project are rolled back
    And the response is a handled error, not a 500 with a stack

  @bdd @provisioning @errors
  Scenario: provisioning is disabled by configuration
    Given anonymous provisioning is turned off for this deployment
    When the caller POSTs to `/provision`
    Then the response is 403 with code `anonymous_provisioning_disabled`
    And the message points a self-hosted operator at the setting
    # self-hosted installs should be able to refuse anonymous account
    # creation outright without patching code.
