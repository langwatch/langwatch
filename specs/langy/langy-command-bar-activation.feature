@unimplemented
Feature: Ask Langy from the command bar
  As a user of LangWatch with Langy enabled
  I want to reach Langy straight from the Cmd+K command bar
  So that I can ask about my project without first finding the panel

  # The command bar (Cmd/Ctrl+K) grows a Langy activation: an "Ask Langy" entry
  # that carries the live query. With a question already typed, selecting it
  # hands the question straight to the Langy panel — one Enter, the panel opens
  # and answers it. Only an empty bar turns the field into an AI composer first
  # (a liquid-glass shimmer/ripple marks the switch), because there is nothing
  # to send yet; Enter from that composer performs the same handoff. Gated on
  # the same visibility as the panel itself (useShowLangy) so the bar never
  # offers an assistant the user can't open.

  Background:
    Given I am authenticated
    And I have access to project "demo"
    And Langy is enabled for me on project "demo"

  # ============================================================================
  # Activation entry points
  # ============================================================================

  Scenario: Ask Langy is offered in the command bar
    Given the command bar is open on a project page
    When I have typed nothing
    Then an "Ask Langy" activation is shown at the top of the results

  Scenario: Ask Langy carries the typed question
    Given the command bar is open on a project page
    When I type "why are my traces failing"
    Then the top activation reads Ask Langy with "why are my traces failing"

  Scenario: The activation is hidden when Langy is unavailable
    Given Langy is not enabled for me
    When the command bar is open
    Then no Ask Langy activation is shown

  Scenario: The activation is hidden off project pages
    Given the command bar is open on a non-project route
    Then no Ask Langy activation is shown

  # ============================================================================
  # Selecting the activation — one Enter with a question, AI mode without one
  # ============================================================================

  Scenario: Selecting Ask Langy with a typed question hands it off in one step
    Given the command bar is open with "summarise last night's runs" typed
    When I select the Ask Langy activation by Enter or by click
    Then the command bar fades out and closes
    And the Langy panel opens
    And Langy starts a fresh conversation and asks "summarise last night's runs"
    And no intermediate composer step appears in between

  Scenario: Selecting Ask Langy on an empty bar turns it into AI mode
    Given the command bar is open with nothing typed
    When I select the Ask Langy activation
    Then the command bar switches into AI mode
    And a shimmer-and-ripple plays across the surface
    And nothing is sent to Langy yet

  Scenario: Reduced motion drops the shimmer
    Given I prefer reduced motion
    When I enter AI mode
    Then the AI surface renders without the shimmer or ripple animation

  Scenario: Escape leaves AI mode without closing the bar
    Given the command bar is in AI mode
    When I press Escape
    Then the bar returns to normal command mode
    And the bar stays open

  Scenario: Backspace on an empty AI composer leaves AI mode
    Given the command bar is in AI mode with an empty composer
    When I press Backspace
    Then the bar returns to normal command mode

  # ============================================================================
  # Handoff — Enter opens Langy and asks
  # ============================================================================

  Scenario: Enter hands the question to Langy
    Given the command bar is in AI mode with "find the slowest traces" typed
    When I press Enter
    Then the command bar fades out and closes
    And the Langy panel opens
    And Langy starts a fresh conversation and asks "find the slowest traces"

  Scenario: Enter on an empty AI composer just opens Langy
    Given the command bar is in AI mode with an empty composer
    When I press Enter
    Then the Langy panel opens on an empty conversation
    And no message is sent

  Scenario: The handoff waits for any in-flight turn to settle
    Given a Langy turn is already streaming
    When I hand a new question off from the command bar
    Then the queued question is sent once the current turn finishes

  Scenario: The composer is ready to keep typing after a handoff
    Given I hand a question to Langy from the command bar
    When the Langy panel opens with the question sent
    Then the panel's composer holds keyboard focus

  # ============================================================================
  # Model picker while a turn is pending
  # ============================================================================

  Scenario: The composer model picker is disabled while a turn is pending
    Given a Langy turn is submitted or streaming
    Then the composer's model picker is disabled
    And it cannot be opened until the turn settles
