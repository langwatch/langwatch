Feature: Lent tokens live in their owner's client, wave 4
  Trace and coding-agent lend their components by tokens declared in their own
  client packages, and trace reads annotation's form, scenario's media renderer
  and onboarding's guided path by those owners' client tokens. A reader imports
  the token from the owner's client and reads it, without importing the owner's
  browser package or naming the capability as a string (ARCHITECTURE.md §10.1).

  @unit
  Scenario: Trace and coding-agent lend by their client tokens
    Given the trace and coding-agent browsers are installed
    When a reader looks up each token from its owner's client
    Then the owner's lent component is found for it

  @integration
  Scenario: Scenario wraps a turn in trace's hover peek through its client token
    Given trace lends its trace preview hover card by token
    When scenario draws a turn's trigger inside the hover peek
    Then trace's peek wraps the trigger

  @integration
  Scenario: An uninstalled trace leaves scenario's turn without a peek
    Given no installed module lends the trace preview hover card token
    When scenario draws a turn's trigger inside the hover peek
    Then the trigger renders on its own and nothing fails

  @integration
  Scenario: Project draws trace's agent actions menu through its client token
    Given trace lends its agent actions menu by token
    When project's home draws the agent actions menu in its place
    Then trace's menu renders there, and without trace nothing renders

  @integration
  Scenario: Trace reads onboarding's guided path through its client token
    Given onboarding lends its guided path hooks by token
    And a guided onboarding path is active
    When the first traces arrive in the Trace Explorer
    Then the first-trace tour stays quiet

  @integration
  Scenario: An uninstalled onboarding leaves trace's first-trace tour free to start
    Given no installed module lends the guided path token
    When the first traces arrive in the Trace Explorer
    Then the first-trace tour starts

  @integration
  Scenario: Trace draws scenario's media part through scenario's client token
    Given scenario lends its media renderer by token
    When trace draws a media part of a trace
    Then scenario's renderer draws it, and without scenario nothing renders

  @integration
  Scenario: Trace draws annotation's form body through annotation's client token
    Given annotation lends its annotation form body by token
    When trace draws the annotation form over its form state
    Then annotation's body draws it, and without annotation nothing renders
