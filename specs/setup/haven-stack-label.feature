Feature: the development badge names the haven stack
  A developer running several haven stacks side by side cannot tell their tabs
  apart when every one of them says "DEV". Haven already knows each stack's
  slug, so it hands the slug to the app, and the development badge in the top
  bar reads the slug instead. A development build outside haven, and every
  production build, draw exactly what they drew before.

  @unit
  Scenario: haven names the development badge after its stack
    Given a haven stack whose slug is "feat-strict-feature-layout-v0"
    When haven composes the environment for the stack's processes
    Then DEV_INDICATOR_LABEL is "feat-strict-feature-layout-v0"

  @unit
  Scenario: the browser is handed the badge label only when the deployment names one
    Given a development deployment
    When DEV_INDICATOR_LABEL is set to a stack slug
    Then the browser's process config carries that slug as the badge label
    When DEV_INDICATOR_LABEL is unset or blank
    Then the browser's process config carries no badge label

  @integration
  Scenario: the development badge shows the stack's slug
    Given a development build whose deployment names the stack "feat-strict-feature-layout-v0"
    When the top bar is drawn
    Then the development badge reads "feat-strict-feature-layout-v0" instead of "DEV"

  @integration
  Scenario: a long stack slug truncates with the full name in a tooltip
    Given a development build whose stack slug is too long for the badge
    When the developer hovers the development badge
    Then the badge is truncated with an ellipsis
    And a tooltip shows the full slug

  @integration
  Scenario: a development build outside haven still reads DEV
    Given a development build whose deployment names no stack
    When the top bar is drawn
    Then the development badge reads "DEV"
