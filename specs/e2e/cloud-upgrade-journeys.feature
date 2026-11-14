@e2e
Feature: Upgrading a Free organization to Growth on LangWatch Cloud
  As a member of a Free organization on LangWatch Cloud
  I want to buy the Growth plan from the subscription and plans pages
  So that my organization gets the seats and events it needs without asking sales

  The journeys run a real stack in the saas deployment mode against paymentsim,
  the payment provider simulator, which serves the payment provider's API,
  hosts the checkout page and signs the webhooks billing verifies. Each journey
  signs up its own administrator and organization on its own domain, so runs on
  a long-lived stack never collide. Webhooks are processed asynchronously, so a
  journey waits for the plan to change rather than expecting it at once.

  Background:
    Given the stack runs the saas deployment mode with paymentsim as its payment provider
    And an administrator signed up and created an organization on the Free plan

  Scenario: A Free organization with one member upgrades to Growth
    Given the organization has the administrator as its only member
    When the administrator opens the subscription page
    And presses "Upgrade to Growth" on the Free plan card
    Then the browser leaves for the payment provider's checkout page
    When the administrator pays on the checkout page
    Then the browser returns to the subscription page with the subscription activated
    And the plan card names the Growth plan once the payment provider's webhooks are processed

  Scenario: Upgrade now on the plans page reaches the checkout
    When the administrator opens the plans page
    And presses "Upgrade now" in the Growth column
    Then the browser leaves for the payment provider's checkout page

  Scenario: A Member who is not an administrator starts the checkout
    Given a second person joined the organization by invitation with the Member role
    When the Member opens the subscription page
    And presses "Upgrade to Growth" on the Free plan card
    Then the browser leaves for the payment provider's checkout page
