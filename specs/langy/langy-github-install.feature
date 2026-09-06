# Langy's use of the organization GitHub connection
#
# The connection itself (install flow, webhooks, permissions, disconnect) is
# specified in specs/integrations/github-connection.feature. This file keeps
# only what is Langy-specific: how a turn consumes the connection.
#
# Attribution is bot-authored: PRs and commits are made by the app, with a
# "Requested by @<login> via LangWatch" note and a Co-authored-by trailer for
# the requesting user. There is no per-user GitHub OAuth — the installation is
# the whole access boundary.

Feature: Langy uses the organization GitHub connection

  Background:
    Given I am signed in to LangWatch
    And I am a member of the "acme" organization

  @integration
  Scenario: A Langy turn mints repository-bounded credentials from the connection
    Given the "acme" organization has a GitHub installation
    When a Langy turn requests GitHub credentials
    Then the turn receives a short-lived token bounded to the installation's repositories
    And no token is ever persisted

  @integration
  Scenario: Without a connection the turn carries no GitHub credentials
    Given the "acme" organization has no GitHub installation
    When a Langy turn requests GitHub credentials
    Then the turn proceeds without GitHub credentials
    And a GitHub-reaching command surfaces the not connected failure
