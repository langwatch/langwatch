Feature: PostHog campaign conversion events
  As the team sending email campaigns
  I want sign in, sign up and paid subscription captured in PostHog with campaign attribution
  So that one funnel shows email click, app usage, sign up and paid

  Background:
    Given the browser stores first-touch attribution from "ref" and "utm_*" URL params and the referrer
    And posthog-js identifies a browser person by the user id
    And trackServerEvent uses that same user id as the distinct id so both sides join

  # ---------------------------------------------------------------------------
  # signed_in: an identified user loaded the app
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An identified user loading the app tracks signed_in with stored attribution
    Given first-touch attribution is stored with utm_source "newsletter" and utm_campaign "weekly"
    When an identified user loads the app
    Then one "signed_in" PostHog event is captured
    And it carries utm_source "newsletter" and utm_campaign "weekly"

  @unit
  Scenario: UTM params on the current URL are reported on signed_in
    Given first-touch attribution is stored with utm_source "google"
    And the current URL has utm_source "newsletter" and utm_content "cta"
    When an identified user loads the app
    Then the "signed_in" event carries utm_source "newsletter" and utm_content "cta"
    And it carries none of the stored attribution

  @unit
  Scenario: signed_in without any attribution carries no attribution properties
    Given no attribution is stored and the current URL has no UTM params
    When an identified user loads the app
    Then one "signed_in" PostHog event is captured with no properties

  @unit
  Scenario: signed_in is captured once per browser session
    Given an identified user already tracked "signed_in" in this browser session
    When the user loads the app again in the same session
    Then no further "signed_in" event is captured

  @unit
  Scenario: A different user signing in on the same tab tracks signed_in again
    Given user A tracked "signed_in" in this browser session
    When user B is identified on the same tab
    Then a "signed_in" event is captured for user B

  @unit
  Scenario: A user who already signed in on the tab is not counted again after another user
    Given user A and then user B tracked "signed_in" in this browser session
    When the tab reloads and user A is identified again
    Then no further "signed_in" event is captured

  @unit
  Scenario: Anonymous visitors track no signed_in event
    When a visitor without a session loads the app
    Then no "signed_in" event is captured

  # ---------------------------------------------------------------------------
  # organization_created: where sign-up attribution reaches the server
  #
  # The signed_up milestone is tracked at account creation, before the
  # browser has sent attribution. The onboarding form delivers it, so the
  # attribution is tracked there on its own event and on the person.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Organization creation tracks sign-up attribution in PostHog
    Given a user completes onboarding with utm_source "newsletter" and utm_medium "email"
    When the organization is initialized
    Then an "organization_created" PostHog event is tracked for that user id
    And it carries the organization id, utm_source "newsletter" and utm_medium "email"
    And the person properties signup_utm_source and signup_utm_medium are set once

  @unit
  Scenario: Organization creation without attribution tracks no attribution properties
    Given a user completes onboarding with no attribution
    When the organization is initialized
    Then the "organization_created" event carries no attribution properties
    And no person property is set

  @unit
  Scenario: Initializing an organization through the procedure tracks organization_created
    Given a user submits the onboarding form with utm_source "newsletter"
    When the initializeOrganization procedure succeeds
    Then an "organization_created" PostHog event is tracked with utm_source "newsletter"

  # ---------------------------------------------------------------------------
  # subscription_started: a subscription became active
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A started subscription tracks subscription_started for every organization member
    Given an organization with two members
    When its subscription becomes active on plan "GROWTH_SEAT_EUR_MONTHLY"
    Then a "subscription_started" PostHog event is tracked for each member user id
    And each carries the plan and the organization id

  @unit
  Scenario: subscription_started is skipped when PostHog is not configured
    Given no PostHog key is configured
    When a subscription becomes active
    Then organization members are not queried and no event is tracked

  @unit
  Scenario: A failed member lookup does not break the webhook
    Given the organization member lookup fails
    When a subscription becomes active
    Then the error is captured and nothing is thrown

  @unit
  Scenario: The first successful payment reports the subscription as started
    Given a subscription that is not active yet
    When its invoice payment succeeds
    Then the subscription is reported as started with its plan and organization id

  @unit
  Scenario: A renewal payment does not report the subscription as started
    Given a subscription that is already active
    When a later invoice payment succeeds
    Then the subscription is not reported as started

  @unit
  Scenario: A Stripe update that activates a subscription reports it as started
    Given a subscription that is not active yet
    When Stripe reports the subscription as active
    Then the subscription is reported as started with its plan and organization id

  @unit
  Scenario: A Stripe update on an active subscription does not report it as started
    Given a subscription that is already active
    When Stripe reports a quantity change
    Then the subscription is not reported as started
