# See ../adrs/001-provider-neutral-plan-resolution.md

Feature: Provider-neutral entitlement resolution
  As a core feature
  I want one provider-neutral plan contract
  So that limits work in SaaS and self-hosted deployments without importing enterprise code

  @architecture @typecheck
  Scenario: Core consumers import only the entitlement contract
    Given a core feature needs an organization's plan
    Then it depends on @langwatch/entitlement-contract
    And its graph contains no Billing, Licensing, Stripe, Prisma or enterprise implementation

  @unit @entitlements
  Scenario: A valid license has precedence
    Given an organization has a valid non-free license plan
    And it also has an active subscription plan
    When Entitlements resolves the active plan
    Then the complete license plan is returned with source "license"

  @unit @entitlements
  Scenario: A subscription is used when no paid license exists
    Given the license source returns the free plan
    And Billing returns an active subscription plan
    When Entitlements resolves the active plan
    Then the subscription plan is returned with source "subscription"

  @unit @entitlements
  Scenario: A paying Cloud organization resolves its subscription plan
    Given a LangWatch Cloud deployment where the organization holds no paid license
    And the organization's active subscription is on a paid plan with its own trace limit
    When the organization's active plan is resolved
    Then billing's subscription plan answers, with its limit, from source "subscription"

  @unit @entitlements
  Scenario: A Cloud organization with no paid subscription resolves billing's free plan
    Given a LangWatch Cloud deployment where the organization holds no paid license
    And billing answers the free plan with the subscription's own trace limit
    When the organization's active plan is resolved
    Then that free plan answers, with its limit, from source "free"

  @unit @entitlements
  Scenario: A self-hosted deployment never reads a subscription
    Given a self-hosted deployment where the organization holds no paid license
    When the organization's active plan is resolved
    Then billing is not asked and the self-hosted baseline answers

  @unit @entitlements
  Scenario: The core baseline works without enterprise sources
    Given no enterprise entitlement source is installed
    When Entitlements resolves the active plan
    Then the core free plan is returned with source "free"

  @unit @authorization
  Scenario: Operator context is applied after plan selection
    Given an operator is impersonating a customer
    When Entitlements resolves the active plan
    Then plan-source selection is unchanged
    And any limitation override is derived from the operator context once

  @unit @authorization
  Scenario: An impersonating operator is resolved through the user directory
    Given a request names its caller and the platform operator acting as them
    When Entitlements resolves the active plan for that request
    Then the operator's address is read from the user directory before any source sees it
    And a request with no operator acting as the caller resolves the organization's own limitations

  @architecture @typecheck
  Scenario: Provider details do not cross the contract
    Given Billing or Licensing supplies a plan
    Then the resulting value contains only Entitlements contract fields
    And no Stripe identifier, signed-license payload or database record is exposed

  @architecture @typecheck
  Scenario: The entitlement installer constructs its private service
    Given Entitlements contract schemas are compiled independently
    When a runtime installs entitlementServer
    Then EntitlementApp.create constructs its private service from typed sources
    And peers receive the callable EntitlementApi
    And importing the feature starts no work or reads the environment
