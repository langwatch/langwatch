# The organization GitHub connection, one GitHub App installation per org
#
# Implementation:
#   platform/app/src/server/app-layer/github/github-installations.service.ts (record/list/mint, webhook handling)
#   platform/app/src/server/app-layer/github/githubAppToken.ts               (app JWT, installation tokens, GitHub API client)
#   platform/app/src/server/routes/github.ts                                 (install / setup / webhook routes + legacy aliases)
#   platform/app/src/server/api/routers/github.ts                            (connection status, repos, disconnect, live PR status)
#   platform/app/src/pages/settings/integrations.tsx                         (the settings surface)
#
# Related specs:
#   specs/langy/langy-github-install.feature          , Langy-specific use of this connection
#   specs/coding-agent/pull-request-linkage.feature   , the read-only PR mapping use
#
# Motivation: the GitHub App installation began as Langy's. It is the
# organization's connection now: one installation flow, org-scoped storage,
# tokens minted per use and never stored, consumed by Langy (write) and by
# pull-request linkage (read). Managing the connection needs organization
# management permission; seeing whether one exists needs only membership, so
# every surface can invite the right person. The GitHub App's configured Setup
# and Webhook URLs are an external contract: the legacy paths stay mounted as
# aliases until the App configuration is updated.

Feature: Organization GitHub connection

Background:
  Given I am signed in to LangWatch
  And I am a member of the "acme" organization

Rule: Connection state is visible to members, managed by organization managers

  @integration
  Scenario: Any member can see whether GitHub is connected
    Given the "acme" organization has a GitHub installation
    When a member without management permission reads the connection status
    Then they learn the connection exists
    And they are not offered repository names

  @integration
  Scenario: Starting an installation requires organization management
    Given the instance has the GitHub App configured
    When a member without management permission starts an installation
    Then the request is refused

  @integration
  Scenario: Connecting is not gated by the Langy rollout
    Given the instance has the GitHub App configured
    And the "acme" organization has no access to Langy
    When an organization manager starts an installation
    Then the installation flow begins normally

  @integration
  Scenario: App not configured on the instance hides the feature
    Given the instance has no GitHub App private key configured
    When I open the GitHub integration settings
    Then I see that the GitHub integration is unavailable on this instance
    And I am not offered an Install button

  # The install link is a deep link into the GitHub host built from the App
  # slug, so an instance holding an id and a key but no slug mints tokens
  # perfectly well and still has nowhere to send someone who clicks Connect.
  @unit
  Scenario: An instance that cannot start an installation offers no install link
    Given the instance is missing part of what starting an installation needs
    When I read the connection status
    Then no install link comes back

Rule: The instance binds to exactly one GitHub host

  # GitHub Enterprise Server serves the REST API under /api/v3 and the App
  # pages under /github-apps/, so naming the host is not enough on its own.
  # Both bases come from the host in one place, and an instance that names no
  # host behaves exactly as it did before the setting existed.
  @unit
  Scenario: An instance that names no host talks to github.com
    Given the instance names no GitHub host
    When the connection resolves the host it talks to
    Then the host is github.com
    And the API base is the public GitHub API
    And the install link is the github.com app page

  @unit
  Scenario: An instance that names an Enterprise Server host talks to that host
    Given the instance names a GitHub Enterprise Server host
    When the connection resolves the host it talks to
    Then the API base is that host under /api/v3
    And the install link is that host's own app page

  @unit
  Scenario: The uninstall link points at the configured host
    Given the instance names a GitHub Enterprise Server host
    And the "acme" organization has an installation on "acme/service-x"
    When I read where the installation is uninstalled
    Then the link points at that host

  @unit
  Scenario: A repository on the configured host is mapped
    Given the instance names a GitHub Enterprise Server host
    When a session reports a repository on that host
    Then the branch is mapped through the connection

  @unit
  Scenario: A repository on github.com is not mapped by an Enterprise Server instance
    Given the instance names a GitHub Enterprise Server host
    When a session reports a repository on github.com
    Then no mapping is requested

  @unit
  Scenario: A pull request announced over the webhook is recorded under the configured host
    Given the instance names a GitHub Enterprise Server host
    And the "acme" organization has an installation on "acme/service-x"
    When GitHub announces a pull request on a branch
    Then the stored pull request carries that host

Rule: The installation flow verifies who is installing what

  @integration
  Scenario: Starting an installation redirects to GitHub with signed state
    Given the instance has the GitHub App configured
    When I click the install button for my organization
    Then I am redirected to GitHub's app installation page
    And the redirect carries a signed state bound to my session and organization

  @integration
  Scenario: Completing an installation records the installation for my org
    Given the instance has the GitHub App configured
    And I started an installation for the "acme" organization
    When GitHub redirects back to the setup callback with my installation id
    Then the installation is recorded against the "acme" organization
    And settings shows the installed GitHub account and its repository selection

  @integration
  Scenario: Setup callback rejects a tampered or expired state
    Given the instance has the GitHub App configured
    When GitHub redirects to the setup callback with an invalid state
    Then no installation is recorded
    And I am shown that the installation could not be verified

  @integration
  Scenario: An installation cannot be rebound across organizations
    Given the "acme" organization already recorded installation 12345
    When a setup callback tries to record installation 12345 for another organization
    Then the rebind is refused and audited

  @integration
  Scenario: A single installation id is unique but an org may have many
    Given the "acme" organization already has one installation recorded
    When a second installation for a different GitHub account completes for "acme"
    Then both installations are listed for the "acme" organization
    And each installation id appears at most once

Rule: The legacy route paths remain honored until the App configuration moves

  @integration
  Scenario: The setup callback on the legacy path still records
    Given the instance has the GitHub App configured
    And I started an installation for the "acme" organization
    When GitHub redirects to the legacy setup path with my installation id
    Then the installation is recorded against the "acme" organization

  @integration
  Scenario: The webhook on the legacy path still applies
    Given the "acme" organization has an installation on "acme/service-x"
    When GitHub sends a signed installation_repositories event to the legacy webhook path
    Then the recorded repository selection is updated

Rule: Webhooks keep the connection truthful

  @integration
  Scenario: Webhook keeps the repository selection fresh
    Given the "acme" organization has an installation on "acme/service-x"
    When GitHub sends an installation_repositories event adding "acme/service-y"
    And the webhook signature verifies against the configured secret
    Then the recorded repository selection includes "acme/service-y"

  @integration
  Scenario: Webhook rejects an unsigned or wrongly signed payload
    Given the "acme" organization has an installation on "acme/service-x"
    When GitHub sends a webhook whose signature does not match the secret
    Then the payload is rejected
    And the recorded installation is left unchanged

  @integration
  Scenario: Uninstalling removes the installation
    Given the "acme" organization has an installation on "acme/service-x"
    When GitHub sends an installation deleted event that verifies
    Then the installation is removed for the "acme" organization
    And no token can be minted for that installation anymore

  @integration
  Scenario: Disconnect points the admin at GitHub's uninstall page
    Given the "acme" organization has an installation on "acme/service-x"
    When I choose to disconnect the installation in settings
    Then I am given a deep link to uninstall the app on GitHub
    And the recorded installation is cleaned up when GitHub confirms via webhook

Rule: Consumers mint tokens through the connection, never store them

  @integration
  Scenario: Langy still mints a turn token through the connection
    Given the "acme" organization has an installation covering "acme/service-x"
    When a Langy turn requests GitHub credentials
    Then a short-lived installation token is minted for it
    And nothing about the token is persisted

  @unit
  Scenario: Pull request reads mint a read-only token
    Given the "acme" organization has an installation covering "acme/service-x"
    When pull request mapping asks GitHub about a branch
    Then the minted token carries read-only pull request permission
