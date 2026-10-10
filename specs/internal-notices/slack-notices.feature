Feature: The Slack notices LangWatch posts to its own team

  When something worth a person's attention happens - somebody signs up, a
  subscription starts or ends, a licence is bought, an organization hits a
  limit, a self-hosted install raises a lead signal - LangWatch posts a notice
  to one of its own Slack channels. Every notice is a template in
  `@langwatch/internal-slack` on one Block Kit layout, and the module that owns the event
  sends it through its own Slack channel.

  Background:
    Given the Slack notice registry

  @unit
  Scenario: Every notice renders from each of its fixtures
    When each notice is rendered from each of its fixtures
    Then the blocks match the stored rendering

  @unit
  Scenario: Every notice opens with one status emoji in its header
    When each notice is rendered
    Then its header starts with exactly one of the status emoji

  @unit
  Scenario: Every notice carries a plain-text fallback for notifications
    When a notice is rendered
    Then its text names the header, the summary and every field

  @unit
  Scenario: Every notice ends with where and when it was sent
    When a notice is rendered
    Then its last block names the environment that sent it
    And the moment it was sent, for Slack to print in the reader's time zone

  @unit
  Scenario: Every link the props carry becomes a button
    When each notice is rendered from each of its fixtures
    Then every link in its props is the address of one of its buttons

  @unit
  Scenario: Words from the product cannot break the message's formatting
    Given an organization named "<!channel> & <https://evil.test|click>"
    When a notice naming it is rendered
    Then the name is escaped and mentions nobody and links nowhere

  @unit
  Scenario: Props that do not match the schema are refused
    Given props with a link that is not a URL
    When the notice is rendered
    Then rendering is refused rather than posting a half-filled notice

  @unit
  Scenario: A new user's announcement names who signed up and where
    When the new-user notice is rendered
    Then it names the user, their email and their organization
    And their phone number and campaign when the sign-up gave them

  @unit
  Scenario: A subscription notice names the organization, the plan and the subscription
    When a prospective, activated or cancelled subscription notice is rendered
    Then it names the organization and the plan
    And an activated one names its subscription, start date, seats and traces a month

  @unit
  Scenario: A limit notice names the organization, its admin, its plan and the cap it hit
    When a plan-limit or resource-limit notice is rendered
    Then it names the organization, the admin's email, the plan and the cap as used over allowed

  @unit
  Scenario: A self-hosted lead signal names the install and what it reports
    When the self-hosted signal notice is rendered
    Then its header is the signal
    And it names the company, the release, the users, the traces over 28 days and the instance

  @unit
  Scenario: A license purchase names the buyer, the plan, the seats and the amount
    When the license purchase notice is rendered
    Then it names the buyer, the plan and the seats
    And the amount in the currency Stripe charged it in

  @unit
  Scenario: A billing threshold failure links to the subscription in Stripe
    When the billing threshold failure notice is rendered
    Then it names the Stripe subscription and the reason
    And it has a button that opens the subscription in Stripe
    And a test-mode subscription opens in Stripe's test dashboard

  @unit
  Scenario: A notice whose channel is not configured is skipped
    Given no webhook is configured for the subscriptions channel
    When billing posts a subscription notice
    Then nothing is sent

  @unit
  Scenario: A Slack send that fails is reported, never thrown
    Given the subscriptions webhook refuses the post
    When billing posts a subscription notice
    Then the failure is logged and reported to error tracking
    And the flow that raised the notice carries on

  @unit
  Scenario: A notice whose props are refused is reported, never thrown
    Given a subscription notice whose admin link is not a URL
    When billing posts it
    Then the refusal is reported to error tracking
    And the flow that raised the notice carries on

  @unit
  Scenario: A sign-up posts the new-user notice to the signups channel
    Given the signups webhook is configured
    When somebody signs up and creates an organization
    Then the new-user notice is posted to the signups channel

  @unit
  Scenario: Joining through a domain or an SSO connection is announced too
    Given the signups webhook is configured
    When somebody joins an organization through its domain or its SSO connection
    Then the new-user notice is posted to the signups channel

  @unit
  Scenario: Customer Slack never uses the internal notice templates
    Given a file under modules/automation imports @langwatch/internal-slack
    When the linter runs
    Then the import is refused with a message pointing at automation's channels
