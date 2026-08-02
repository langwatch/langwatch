Feature: A license never leaves a self-hosted deployment worse off than no license

  A self-hosted deployment with no license runs on the open-source baseline,
  where seats, lite seats and message volume are uncapped. A license sells the
  Enterprise surface (SSO, SCIM, audit logs) and a support relationship, so
  activating one must only ever add. It must never lower a limit the deployment
  already had.

  Without this floor the platform contradicts itself: an unlicensed deployment
  invites the whole company, and the moment it pays for Enterprise it drops to
  the seat count the license happens to encode. Signed licenses are immutable
  once issued, so the floor is applied when the license is resolved into an
  active plan rather than at minting time. That also repairs licenses that were
  already issued, with no re-issuance.

  The floor is a self-hosted policy. On Cloud a license is the negotiated
  contract and overrides the Stripe subscription in both directions, so the
  composite provider is deliberately left alone.

  As an operator of a self-hosted LangWatch deployment
  I want activating an Enterprise license to only ever add capability
  So that paying for LangWatch never costs me seats I already had

  Background:
    Given a self-hosted deployment
    And an organization "org-123" exists

  @unit
  Scenario: An Enterprise license encoding a finite seat count resolves to the uncapped baseline
    Given the organization has a valid Enterprise license
    And the signed payload encodes 100 members and 50 lite members
    When the active plan is resolved
    Then the plan allows at least as many members as the open-source baseline
    And the plan allows at least as many lite members as the open-source baseline
    And the plan is still identified as Enterprise

  @unit
  Scenario: A license encoding a finite message volume resolves to the uncapped baseline
    Given the organization has a valid Enterprise license
    And the signed payload encodes 10000000 messages per month
    When the active plan is resolved
    Then the plan allows at least as many messages per month as the open-source baseline

  @unit
  Scenario: A license that withholds publishing does not remove it
    Given the organization has a valid license
    And the signed payload sets canPublish to false
    When the active plan is resolved
    Then the plan still allows publishing

  @unit
  Scenario: The floor only raises limits and never lowers them
    Given the organization has a valid license
    And the signed payload encodes limits above the open-source baseline
    When the active plan is resolved
    Then each limit from the license is preserved

  @unit
  Scenario: Plan identity survives the floor
    Given the organization has a valid Enterprise license
    When the active plan is resolved
    Then the plan type, name and paid status come from the license
    And the plan source is reported as "license"

  @unit
  Scenario: A deployment with no license still resolves to the baseline
    Given the organization has no license stored
    When the active plan is resolved
    Then the plan is the open-source baseline
    And the plan source is reported as "free"
