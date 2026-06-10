Feature: Self-hosted deployment surfaces personal-keys onboarding cleanly
  In iter-1 the governance-platform shipped Personal Workspaces, the
  AI Gateway sub-chart, RoutingPolicies, and the CLI device-flow.
  Self-hosters running `helm install` need a single coherent path
  from `helm install` to "my devs are running `langwatch login`",
  with no archaeology through scattered .env files, GitHub issues,
  or undocumented sub-chart values.

  This spec captures the behaviour the umbrella `langwatch` chart
  must guarantee for that path. Implementation lives in
  charts/langwatch/templates and docs/self-hosting/.

  Background:
    Given an admin running Kubernetes 1.28+ with Helm 3
    And the umbrella `langwatch` chart is installed at version 3.1.0+
    And the admin has set `gateway.chartManaged=true` (the default)

  Scenario: Helm install surfaces the post-install admin checklist
    When the admin runs `helm install langwatch langwatch/langwatch`
    Then the install output includes a NOTES section
    And the NOTES section names every required post-install step
    And each step has a copy-pasteable command or URL
    And the steps are ordered so a first-time admin can follow them top to bottom

  Scenario: NOTES.txt covers the iter-1 personal-keys onboarding flow
    When the admin reads the helm post-install NOTES
    Then the NOTES tell them how to reach the LangWatch UI for the first time
    And the NOTES tell them to add at least one ModelProvider credential
    And the NOTES tell them to publish a default RoutingPolicy at organization scope
    And the NOTES tell their devs the exact `langwatch login` command + base URL
    And the NOTES link to the matching docs/self-hosting page for deeper context

  Scenario: Required gateway secrets fail loudly when missing
    Given the admin has not pre-created the `langwatch-gateway-auth` Secret
    When the admin runs `helm install langwatch langwatch/langwatch --set gateway.chartManaged=true`
    Then the install fails before any pod is scheduled
    And the failure message names the missing Secret
    And the failure message links to the docs page documenting how to create it
    And no half-deployed state is left behind

  Scenario: Optional starter RoutingPolicy bootstraps via helm value
    Given the admin sets `gateway.bootstrap.defaultRoutingPolicy.enabled=true`
    And the admin sets `gateway.bootstrap.defaultRoutingPolicy.providerCredentialIds=["openai-prod"]`
    When the admin runs `helm install langwatch ...`
    Then the post-install NOTES indicate the policy will be auto-created on first boot
    And the NOTES warn that the matching ProviderCredential must exist or be created
    And the NOTES explain how to disable the bootstrap for full manual control

  Scenario: AI Gateway base URL is auto-derived for cluster-internal routing
    Given the admin has not overridden `gateway.controlPlane.baseUrl`
    When helm renders the gateway Deployment
    Then the gateway pod receives `LW_GATEWAY_BASE_URL=http://langwatch-app:5560`
    And the langwatch-app pod receives the gateway service URL via env
    And the values.yaml comment explains how to override for split-domain installs

  Scenario: Self-host docs walk admin through the iter-1 flow end to end
    Given the admin lands on docs/ai-gateway/self-hosting/
    When the admin opens the personal-keys-onboarding page
    Then it covers, in order:
      | step                                                              |
      | 1. Pre-create the gateway-auth Secret with the two shared tokens   |
      | 2. helm install (or upgrade) the umbrella chart                    |
      | 3. First-login as the bootstrap admin to claim the org             |
      | 4. Add a ModelProvider credential (Anthropic / OpenAI / Bedrock)   |
      | 5. Create the default RoutingPolicy at organization scope          |
      | 6. Distribute `langwatch login --url=https://<your-host>` to devs  |
    And each step links back to the canonical reference doc
    And the page tests its commands by emitting them in copy-pasteable code blocks
