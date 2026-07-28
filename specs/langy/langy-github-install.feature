Feature: Installing the LangWatch GitHub App for Langy
  As a LangWatch organization admin
  I want to install the LangWatch GitHub App on the repositories Langy may touch
  So that Langy can open pull requests bounded to exactly those repositories

  # Attribution is bot-authored: PRs and commits are made by the app, with a
  # "Requested by @<login> via LangWatch" note and a Co-authored-by trailer for
  # the requesting user. There is no per-user GitHub OAuth — the installation is
  # the whole access boundary.

  Background:
    Given I am signed in to LangWatch
    And I am a member of the "acme" organization

  @integration
  Scenario: App not configured on the instance hides the feature
    Given the instance has no GitHub App private key configured
    When I open the GitHub integration settings
    Then I see that the GitHub integration is unavailable on this instance
    And I am not offered an Install button

  @integration
  Scenario: Starting an installation redirects to GitHub with signed state
    Given the instance has the GitHub App configured
    When I click "Install the LangWatch GitHub App" for my organization
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
  Scenario: A single installation id is unique but an org may have many
    Given the "acme" organization already has one installation recorded
    When a second installation for a different GitHub account completes for "acme"
    Then both installations are listed for the "acme" organization
    And each installation id appears at most once

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
    And Langy can no longer mint a token for that installation

  @integration
  Scenario: Disconnect points the admin at GitHub's uninstall page
    Given the "acme" organization has an installation on "acme/service-x"
    When I choose to disconnect the installation in settings
    Then I am given a deep link to uninstall the app on GitHub
    And the recorded installation is cleaned up when GitHub confirms via webhook
