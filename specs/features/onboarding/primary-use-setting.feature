Feature: Organization "Primary use" setting
  The primary intent chosen at signup becomes an organization setting.
  Org admins can change it later, so a wrong pick at signup is
  self-serviceable and legacy organizations can opt into intent-based
  landing. Changing it repoints where "/" lands; it does not replay the
  onboarding the organization skipped.

  ADR: dev/docs/adr/038-intent-forked-onboarding-governance-vs-llmops.md
  Pairs with:
    - specs/ai-gateway/governance/org-intent-home-resolution.feature (what the value does)

  Background:
    Given an existing organization

  Rule: only org admins can see and change the primary use

    @integration @unimplemented
    Scenario: Org admin edits the primary use in organization settings
      Given the user can manage the organization
      When the user opens the organization settings page
      Then the user sees a "Primary use" field showing the current value
      And the user can change it between agent governance and LLMOps

    @integration @unimplemented
    Scenario: Non-admin members cannot change the primary use
      Given the user cannot manage the organization
      When the user opens the organization settings page
      Then the user cannot change the primary use

  Rule: legacy organizations start without a value and adopt one deliberately

    @integration @unimplemented
    Scenario: A legacy organization shows no primary use selected
      Given the organization was created before the intent fork existed
      When an org admin opens the organization settings page
      Then the "Primary use" field shows that none is set
      And the organization keeps today's landing behavior until one is chosen

  Rule: flipping to LLMOps offers the project setup instead of a dead landing

    @integration @unimplemented
    Scenario: Governance organization flips to LLMOps
      Given the organization has the agent-governance intent
      And its default project was never integrated
      When an org admin changes the primary use to LLMOps
      Then the admin is offered the LLMOps setup path for the default project
      And subsequent "/" landings go to the project home
      # Guards red-team F9: without the setup offer, everyone lands on an
      # empty, never-onboarded project.

    @integration @unimplemented
    Scenario: LLMOps organization flips to agent governance
      Given the organization has the LLMOps intent
      When an org admin changes the primary use to agent governance
      Then subsequent "/" landings go to the personal usage page
      And existing projects and their data remain reachable through navigation
