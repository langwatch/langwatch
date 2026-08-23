# See ../adrs/001-provider-neutral-plan-resolution.md

Feature: Provider-neutral entitlement resolution
  As a core feature
  I want one provider-neutral plan contract
  So that limits work in SaaS and self-hosted deployments without importing enterprise code

  @architecture @typecheck
  Scenario: Core consumers import only the entitlement contract
    Given a core feature needs an organization's plan
    Then it depends on @langwatch/entitlements-contract
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

  @architecture @typecheck
  Scenario: Provider details do not cross the contract
    Given Billing or Licensing supplies a plan
    Then the resulting value contains only Entitlements contract fields
    And no Stripe identifier, signed-license payload or database record is exposed

  @architecture @typecheck
  Scenario: Entitlements is a class service with a compiled Zod contract
    Given Entitlements contract schemas are compiled independently
    When a runtime composes EntitlementsService
    Then it calls EntitlementsService.create with typed sources and configuration
    And no standalone service factory or direct environment read exists
