Feature: AI Gateway Governance — CLI login (RFC 8628 device-code flow)
  As an enterprise developer at an org that has rolled out LangWatch governance
  I want to authenticate the `langwatch` CLI on my laptop using my company SSO
  So that every coding tool I run (Claude Code, Codex, Cursor, Gemini CLI) goes
  through the LangWatch gateway with my identity, my org's policy, and my own
  attribution — without me ever handling a raw provider API key

  This realises gateway.md "screens 0-4" of the personal-keys storyboard.
  The CLI implements the OAuth 2.0 Device Authorization Grant (RFC 8628):
  the device requests a short user_code + verification_uri, opens a browser
  for the user to authenticate via SAML/OIDC SSO at LangWatch (which hops to
  the customer Okta/Azure AD), then polls /exchange until the user completes
  the browser flow. The result is an access_token + refresh_token persisted
  to ~/.langwatch/config (refresh token in OS keyring on macOS/Windows;
  fall back to file with 0600 perms on Linux without keyring).

  Background:
    Given the LangWatch app is running at "https://app.langwatch.example.com"
    And organization "acme" has SAML SSO configured against "acme.okta.com"
    And user "jane@acme.com" exists in organization "acme" with role MEMBER
    And user "jane@acme.com" has a personal team and personal project auto-created

  # ---------------------------------------------------------------------------
  # Device authorization — happy path
  # ---------------------------------------------------------------------------

  @bdd @cli @device-flow
  Scenario: CLI requests a device code and receives a short user code + verification URI
    When the CLI POSTs to "/api/auth/cli/device-code"
    Then the response status is 200
    And the response body contains:
      | field             | shape                                             |
      | device_code       | opaque ≥32-char string                            |
      | user_code         | 8 chars, base32 alphabet, dashed XXXX-XXXX        |
      | verification_uri  | absolute URL ending with "/cli/auth"              |
      | expires_in        | integer seconds, ≥ 300 and ≤ 900                  |
      | interval          | integer seconds, ≥ 5 (polling minimum)            |
    And the device_code is stored server-side keyed for fast lookup
    And the device_code expires after `expires_in` seconds

  @bdd @cli @device-flow @ux
  Scenario: CLI prints the user_code and opens the browser
    Given the CLI received a valid device-code response
    When the CLI proceeds with the login flow
    Then it prints the user_code prominently to stdout
    And it prints the verification_uri
    And it attempts to open the verification_uri in the default browser
    And it begins polling "/api/auth/cli/exchange" at the returned interval

  @bdd @cli @device-flow @sso
  Scenario: User completes browser SSO and approves the device
    Given the CLI is polling with a valid device_code
    And the verification page shows the user_code "ABCD-EFGH"
    When user "jane@acme.com" enters her email at "/cli/auth"
    And LangWatch redirects to "acme.okta.com" for SAML authentication
    And Jane completes the Okta SSO + MFA prompt
    And LangWatch resolves Jane to user_id "user_jane_123" + organization "acme"
    And Jane confirms the device prompt showing user_code "ABCD-EFGH"
    Then the device is marked APPROVED for user_jane_123 + organization "acme"

  @bdd @cli @device-flow @poll
  Scenario: CLI exchange returns tokens once user has approved
    Given the device with user_code "ABCD-EFGH" has been APPROVED
    When the CLI POSTs to "/api/auth/cli/exchange" with the device_code
    Then the response status is 200
    And the response body contains:
      | field                    | shape                                       |
      | access_token             | JWT, ≤ 1h TTL                               |
      | refresh_token            | opaque ≥40-char string                      |
      | expires_in               | integer seconds                             |
      | user.id                  | "user_jane_123"                             |
      | user.email               | "jane@acme.com"                             |
      | user.name                | non-empty string                            |
      | organization.id          | "acme"                                      |
      | organization.name        | non-empty string                            |
      | default_personal_vk      | the personal VK that was auto-issued at login |

  @bdd @cli @device-flow @poll
  Scenario: CLI exchange returns 428 while user has not yet completed approval
    Given the device_code is valid but the user has not yet approved it
    When the CLI POSTs to "/api/auth/cli/exchange" with the device_code
    Then the response status is 428
    And the response body contains `{ "status": "pending" }`
    And the CLI keeps polling at the returned interval

  @bdd @cli @device-flow @poll @timeout
  Scenario: CLI exchange returns 408 once the device_code has expired
    Given the device_code has expired
    When the CLI POSTs to "/api/auth/cli/exchange" with the device_code
    Then the response status is 408
    And the response body contains `{ "status": "expired" }`
    And the CLI prints a clear "Login expired, please re-run langwatch login" message
    And the CLI exits with non-zero status

  @bdd @cli @device-flow @poll
  Scenario: CLI exchange returns 410 when the user explicitly denied the device
    Given the user explicitly clicked "Deny" on the device confirmation page
    When the CLI POSTs to "/api/auth/cli/exchange" with the device_code
    Then the response status is 410
    And the response body contains `{ "status": "denied" }`
    And the CLI prints a clear denial message and exits non-zero

  @bdd @cli @device-flow @rate-limit
  Scenario: CLI exchange enforces minimum polling interval
    Given the device_code is valid and pending
    When the CLI polls "/api/auth/cli/exchange" faster than the returned interval
    Then the second response within the interval window returns 429
    And the response body suggests the safe `interval` value

  # ---------------------------------------------------------------------------
  # Token persistence and refresh
  # ---------------------------------------------------------------------------

  @bdd @cli @config
  Scenario: CLI persists tokens to local config after successful exchange
    Given the CLI successfully exchanged a device_code for tokens
    Then the access_token is stored in "~/.langwatch/config" with 0600 perms
    And the refresh_token is stored in the OS keyring on macOS/Windows
    And on Linux without keyring, the refresh_token is stored in the same file with 0600 perms
    And the config file records `user.email`, `organization.id`, and `default_personal_vk`

  @bdd @cli @refresh
  Scenario: CLI refreshes the access token before it expires
    Given the access_token has 5 minutes or less remaining
    And the CLI is asked to run a wrapped command (e.g. `langwatch claude`)
    When the CLI POSTs to "/api/auth/cli/refresh" with the refresh_token
    Then the response status is 200
    And the response body contains a fresh `access_token` and a fresh `refresh_token`
    And both tokens are persisted as in the previous scenario

  @bdd @cli @refresh @errors
  Scenario: CLI handles refresh-token revocation cleanly
    Given the refresh_token has been revoked (e.g. user deactivated, admin revoke)
    When the CLI POSTs to "/api/auth/cli/refresh" with the refresh_token
    Then the response status is 401
    And the CLI deletes the local config + keyring entry
    And the CLI prints "Session revoked — run `langwatch login` to sign in again"
    And the CLI exits non-zero

  # ---------------------------------------------------------------------------
  # Logout
  # ---------------------------------------------------------------------------

  @bdd @cli @logout
  Scenario: `langwatch logout` revokes the refresh token and wipes local state
    Given the CLI is currently authenticated
    When I run "langwatch logout"
    Then the CLI POSTs to "/api/auth/cli/logout"
    And the server revokes both the access_token and refresh_token
    And the CLI deletes "~/.langwatch/config" and the OS keyring entry
    And the CLI prints "Logged out"

  # ---------------------------------------------------------------------------
  # Multi-org user (out of scope this iteration but pinned for design clarity)
  # ---------------------------------------------------------------------------

  @bdd @cli @multi-org @future
  Scenario: User in multiple orgs is asked to pick a default during exchange
    Given user "jane@acme.com" is a member of organizations ["acme", "personal-side-project"]
    When she completes the SSO flow
    Then the device confirmation page asks her to pick a default organization
    And the chosen organization is bound to the issued access_token
    And `langwatch organization switch <org-slug>` (deferred) re-issues a token bound to a different org
