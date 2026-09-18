Feature: Organization primary intent decides the "/" landing
  When an organization has a primary intent set, that intent alone decides
  where "/" lands: agent-governance organizations land on the personal
  usage page, LLMOps organizations land on the project home. Organizations
  without an intent (every organization created before the fork, and any
  created outside onboarding) keep today's resolver behavior unchanged.

  The rule binds BOTH routing layers: the server-side home resolver and
  the client-side redirect wrapper that applies last-visited stickiness.
  Without the second half, a user's visit history silently overrides the
  organization setting.

  ADR: dev/docs/adr/038-intent-forked-onboarding-governance-vs-llmops.md
  Pairs with:
    - specs/ai-gateway/governance/persona-home-resolver.feature (legacy path, untouched for intent-less orgs)
    - specs/features/onboarding/intent-fork.feature (how intent gets set)

  Background:
    Given an authenticated user landing on "/"

  # ============================================================================
  # Intent set — the hard rule
  # ============================================================================

  Rule: when the organization has an intent, it decides the landing — pin and stickiness are not consulted

    @unit
    Scenario: Agent-governance organization lands on the personal usage page
      Given the user's organization has the agent-governance intent
      When the home resolver runs
      Then the destination is the personal usage page
      And persona inference did not run

    @unit
    Scenario: LLMOps organization lands on the project home
      Given the user's organization has the LLMOps intent
      And the user is a member of at least one project
      When the home resolver runs
      Then the destination is a project home
      And the specific project is picked by the existing last-visited or first-membership logic

    @unit
    Scenario: An explicit user pin does not override the organization intent
      Given the user's organization has the LLMOps intent
      And the user previously pinned the personal usage page as their home
      When the home resolver runs
      Then the destination is a project home

    @unit
    Scenario: Last-visited stickiness does not override the organization intent
      Given the user's organization has the agent-governance intent
      And the user last visited a project home
      When the "/" destination is resolved end to end, including the client redirect layer
      Then the user lands on the personal usage page
      # Guards red-team F8: the client wrapper must pass an intent-decided
      # destination through untouched instead of re-applying stickiness.

    @unit
    Scenario: The resolver tells the client when intent decided the destination
      Given the user's organization has an intent set
      When the home resolver responds
      Then the response marks the destination as intent-decided
      And the client redirect layer returns the server destination unchanged when it is marked
      And a user-set explicit pin is still reported through its own existing field, not the new marker

  Rule: a kill-switched governance organization never lands on a gated 404

    @unit
    Scenario: Agent-governance intent with governance disabled falls back to the project home
      Given the user's organization has the agent-governance intent
      But the governance UI is disabled for the organization
      And the user is a member of at least one project
      When the home resolver runs
      Then the destination is a project home
      And not the personal usage page

  # ============================================================================
  # No intent — the legacy path, bit-identical
  # ============================================================================

  Rule: organizations without an intent keep today's resolver behavior exactly

    @unit
    Scenario Outline: Every legacy persona resolves as it does today
      Given the user's organization has no primary intent
      And the user matches persona "<persona>" from the persona home resolver spec
      When the home resolver runs
      Then the destination equals today's resolver output for that persona
      And it is unchanged whether the governance flag is on or off for intent-less behavior

      Examples:
        | persona                       |
        | personal-only                 |
        | mixed                         |
        | project-only LLMOps           |
        | super-admin governance        |

    @unit
    Scenario: Legacy organizations keep pin and stickiness behavior
      Given the user's organization has no primary intent
      And the user has an explicit home pin
      When the "/" destination is resolved end to end
      Then the pin wins exactly as today

  # ============================================================================
  # Multi-organization users
  # ============================================================================

  Rule: the landing follows the currently selected organization's intent

    @unit
    Scenario: Each organization routes by its own intent
      Given the user belongs to an agent-governance organization and an LLMOps organization
      When the user lands on "/" with the agent-governance organization selected
      Then the destination is the personal usage page
      When the user lands on "/" with the LLMOps organization selected
      Then the destination is a project home

    @unit @unimplemented
    Scenario: A fresh device with no stored selection uses the first organization
      Given the user belongs to multiple organizations
      And the device has no stored organization selection
      When the home resolver runs
      Then the destination follows the first organization's intent
      # Accepted edge (ADR Consequences): arbitrary until the user picks an org.
