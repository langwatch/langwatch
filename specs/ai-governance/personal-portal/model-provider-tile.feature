Feature: AI Tools Portal — Model-provider tile inline VK creation
  As an end user picking a model provider from my /me portal
  I want to issue a virtual key right from the tile (label + button)
  and see the show-once secret + base URL inline
  So that I can wire up my own integration without leaving the portal

  Per Phase 7 architecture (rchaves directive 2026-05-03):
    The model-provider tile reuses `personalVirtualKeys.issuePersonal`
    as the backend mutation, passing the catalog entry's
    `config.suggestedRoutingPolicyId` so the issued VK is bound to the
    same routing policy the admin configured for that provider.

  Background:
    Given user "jane@acme.com" is on /me with the AI Tools Portal visible
    And the org-scoped catalog has a model-provider entry "Anthropic" with:
      | field                     | value                                              |
      | providerKey               | anthropic                                          |
      | suggestedRoutingPolicyId  | rp_default_anthropic                               |
      | defaultLabel              | my-app                                             |
      | projectSuggestionText     | Building an application for your team? Consider .. |
    And the org has a default routing policy published

  Scenario: tile expands into the issuance form
    When user "jane@acme.com" first sees the Anthropic tile
    Then only the tile header (display name + class label + chevron-right) is visible

    When user "jane@acme.com" clicks the Anthropic tile
    Then the body reveals "Issue an Anthropic virtual key"
    And a "Label" input renders pre-populated with "my-app"
    And a primary "Issue key" button renders (enabled because label is non-empty)
    And a ghost "Cancel" button renders
    And the project-suggestion hint renders below the form, prefixed "💡"

  Scenario: empty label disables the Issue button
    Given the Anthropic tile is expanded
    When user "jane@acme.com" clears the label input
    Then the "Issue key" button is disabled
    When user "jane@acme.com" types "another-app"
    Then the "Issue key" button is enabled

  Scenario: successful issuance reveals the secret + base URL
    Given the Anthropic tile is expanded with label "my-app"
    When user "jane@acme.com" clicks "Issue key"
    Then `api.personalVirtualKeys.issuePersonal` is called with parameters:
      | field            | value                |
      | providerKey      | anthropic            |
      | routingPolicyId  | rp_default_anthropic |
      | label            | my-app               |
    And on success the form swaps to a success state showing:
      | field         | value                                |
      | heading       | "✅ Anthropic key issued"            |
      | label         | "my-app"                             |
      | secret        | masked (first 14 chars + "…")        |
      | reveal toggle | eye icon                             |
      | copy button   | copy icon                            |
      | base URL      | "https://gateway.langwatch.ai/v1"    |

  Scenario: secret reveal toggles between masked and full
    Given the success state is showing for issued key "lw_vk_live_abc123def456789"
    When user "jane@acme.com" clicks the eye icon
    Then the full secret renders inline
    And the icon swaps to eye-off
    When user "jane@acme.com" clicks the eye-off icon
    Then the secret returns to its masked form

  Scenario: copy button copies the FULL secret regardless of mask state
    Given the success state is showing for issued key "lw_vk_live_abc123def456789"
    And the secret is currently masked
    When user "jane@acme.com" clicks the copy button
    Then the system clipboard receives the full secret string "lw_vk_live_abc123def456789"
    And the copy icon swaps to check icon for ~1.5 seconds

  Scenario: "Issue another" returns to the form
    Given the success state is showing
    When user "jane@acme.com" clicks "Issue another"
    Then the success state collapses
    And the form re-appears with `defaultLabel` re-populated
    And the secret is no longer accessible (cannot be re-revealed)

  Scenario: 409 no_default_routing_policy surfaces inline
    Given the org has NO default routing policy published
    And the Anthropic tile is expanded with label "my-app"
    When user "jane@acme.com" clicks "Issue key"
    Then `api.personalVirtualKeys.issuePersonal` returns 409 with code "no_default_routing_policy"
    And an inline error renders in the form
    And the error includes a link "Ask your admin to publish a default routing policy"
    And the form does NOT swap to the success state

  Scenario: tile without projectSuggestionText omits the hint
    Given the org-scoped catalog has OpenAI entry with no `projectSuggestionText` field
    When user "jane@acme.com" expands the OpenAI tile
    Then the form renders normally
    And no "💡" project-suggestion footer renders
