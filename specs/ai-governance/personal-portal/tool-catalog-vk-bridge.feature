Feature: AI Tools Portal — model-provider tile → VK bridge
  As a user clicking a model-provider tile on /me
  I want inline VK creation that reuses the existing personalVirtualKeys flow
  So that the catalog entry's suggestedRoutingPolicyId binds the new VK without admin intervention

  Background:
    Given organization "acme" with the portal feature flag on
    And alice is an org MEMBER of "acme"
    And the org has a default RoutingPolicy "developer-default" with id "policy-dev"

  @bdd @phase-7 @vk-bridge @reuse
  Scenario: model-provider tile passes config.suggestedRoutingPolicyId to issuePersonal
    Given an organization-scoped catalog entry exists with type="model_provider", slug="openai", config.suggestedRoutingPolicyId="policy-dev"
    When alice clicks the "OpenAI" tile and submits label="alice-laptop"
    Then the UI calls `personalVirtualKeys.issuePersonal({ organizationId: "acme", label: "alice-laptop", routingPolicyId: "policy-dev" })`
    And the personal VK is bound to RoutingPolicy "policy-dev"
    And the VK secret is returned exactly once
    And no NEW backend endpoint was added — the call goes through the existing personalVirtualKeys router

  @bdd @phase-7 @vk-bridge @no-suggested-policy
  Scenario: model-provider tile without suggestedRoutingPolicyId falls through to default-resolution
    Given an organization-scoped catalog entry exists with type="model_provider", slug="openai", config has NO suggestedRoutingPolicyId
    When alice clicks the "OpenAI" tile and submits label="alice-laptop"
    Then the UI calls `personalVirtualKeys.issuePersonal({ organizationId: "acme", label: "alice-laptop" })` (no routingPolicyId)
    And the existing default-policy resolution runs (resolveDefaultForUser)
    And alice gets a personal VK bound to "policy-dev" (the org default)

  @bdd @phase-7 @vk-bridge @no-default-policy
  Scenario: model-provider tile + no default policy + no suggestedRoutingPolicyId → 409
    Given the org has NO RoutingPolicy with isDefault=true
    And a catalog entry exists with type="model_provider", config has NO suggestedRoutingPolicyId
    When alice clicks the tile and submits a label
    Then the UI calls `personalVirtualKeys.issuePersonal` and receives 409 with `error: "no_default_routing_policy"`
    And NO personal VK is created
    And the UI surfaces the actionable message ("Ask your admin to publish a default routing policy")

  @bdd @phase-7 @vk-bridge @cross-org-guard
  Scenario: catalog entry's suggestedRoutingPolicyId from a different org is rejected
    Given org "other" has a RoutingPolicy "other-policy" with id "policy-other"
    And a catalog entry in "acme" mistakenly has config.suggestedRoutingPolicyId="policy-other"
    When alice clicks the tile and submits a label
    Then `personalVirtualKeys.issuePersonal` resolves the cross-org guard added in 17047a301
    And rejects with PersonalVirtualKeyNotFoundError
    And NO personal VK is created
    And no policy from another org is silently bound to alice's personal VK

  @bdd @phase-7 @vk-bridge @coding-assistant
  Scenario: coding-assistant tile click is purely client-side (no backend involvement)
    Given a catalog entry exists with type="coding_assistant", slug="claude-code", config.setupCommand="langwatch claude"
    When alice clicks the "Claude Code" tile
    Then the UI expands inline to show the setup command + walkthrough
    And NO tRPC mutation is called for the click itself
    And the user runs `langwatch claude` themselves to trigger the existing CLI device-flow

  @bdd @phase-7 @vk-bridge @external-tool
  Scenario: external-tool tile click is purely client-side (markdown render + linkUrl)
    Given a catalog entry exists with type="external_tool", slug="copilot-studio", config has descriptionMarkdown + linkUrl
    When alice clicks the "Copilot Studio" tile
    Then the UI expands inline to render the descriptionMarkdown (sanitized) + a CTA button to the linkUrl
    And NO tRPC mutation is called for the click itself
