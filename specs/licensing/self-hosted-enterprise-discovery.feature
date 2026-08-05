@integration
Feature: Self-hosted deployments can discover what a license unlocks

  A self-hosted operator who never sees SSO, SCIM or audit logs in the product
  has no way to learn they exist short of reading the pricing page. Hiding them
  costs a sale and reads as a missing feature rather than a paid one, so the
  capabilities are listed in Settings with what they do, whether this deployment
  has them, and a link to the setup guide.

  On Cloud these are provisioned by LangWatch as part of the plan, so the
  section would be noise and is not rendered.

  Background:
    Given I am an admin on a self-hosted deployment

  Rule: the enterprise capabilities are visible whether or not they are licensed

    Scenario: An unlicensed deployment sees what a license would unlock
      Given the deployment holds no license
      When I open the authentication settings
      Then I see single sign-on, SCIM provisioning and audit logs listed
      And each one says it requires an Enterprise license
      And each one links to its setup guide

    Scenario: A licensed deployment sees the capabilities as available
      Given the deployment holds a valid Enterprise license
      When I open the authentication settings
      Then I see single sign-on, SCIM provisioning and audit logs listed
      And they are not presented as requiring an upgrade

    Scenario: An unlicensed deployment is told how to obtain a license
      Given the deployment holds no license
      When I open the authentication settings
      Then I can reach the licensing documentation
      And I can reach the license activation page

  Rule: Cloud does not show the section

    Scenario: Cloud hides the self-hosted licensing section
      Given I am an admin on LangWatch Cloud
      When I open the authentication settings
      Then the enterprise capabilities section is not shown
