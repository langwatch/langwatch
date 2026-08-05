Feature: A self-hosted deployment is told the truth about its own license

  Activating a license on a running self-hosted server is the moment an
  operator has the least context and the most to get wrong, so every signal the
  product gives at that moment has to survive long enough to be read and has to
  be true.

  Three things were not. The confirmation that names the restart SSO needs was
  written into a toast and then destroyed by an immediate page reload, so the
  one instruction that matters was the one nobody saw. An unlicensed deployment
  was shown the Cloud Free tier as its current plan, complete with the seat and
  volume numbers of a tier it is not on and is not capped by. And the public key
  an operator configures was read exactly as pasted, so a key carrying escaped
  newlines, which is how a key survives a `.env` file or a Helm value, was
  reported as a bad signature rather than as a formatting problem.

  As an operator activating or configuring a license
  I want the product to report what actually happened
  So that I am not debugging the interface instead of my deployment

  Background:
    Given a self-hosted deployment

  # ============================================================================
  # Activation feedback survives
  # ============================================================================

  @integration
  Scenario: The restart instruction outlives the activation it belongs to
    Given an organization with no license
    When an admin activates a genuine license
    Then they are told the license is active
    And they are told to restart the server if the deployment uses single sign-on
    And that message is still on screen after the page has caught up

  @integration
  Scenario: Removing a license confirms it without discarding the confirmation
    Given an organization holding a license
    When an admin removes it
    Then they are told the organization is now running without a license
    And that message is still on screen after the page has caught up

  # ============================================================================
  # The plan a deployment is actually on
  # ============================================================================

  @unit
  Scenario: An unlicensed deployment is not shown the Cloud free tier as its plan
    Given the organization has no license stored
    When an admin opens the plans page
    Then no Cloud tier is marked as the current plan
    And the seat and volume numbers of the Cloud free tier are not presented as theirs

  @unit
  Scenario: A licensed deployment is still shown the tier its license names
    Given the organization holds a genuine Enterprise license
    When an admin opens the plans page
    Then the Enterprise tier is marked as the current plan

  # ============================================================================
  # The key an operator configured
  # ============================================================================

  @unit
  Scenario: A verification key pasted with escaped newlines still verifies
    Given the operator configured the verification key as a single line with escaped newlines
    When a genuine license is checked against it
    Then the license verifies
    And it is not reported as a bad signature
