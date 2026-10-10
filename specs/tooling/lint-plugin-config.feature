Feature: The langwatch plugin registry and the oxlint configs agree

  The plugin registers each rule once, keyed by the name its `defineRule`
  declaration carries, in `packages/oxlint-rules/src/index.mjs`. Lint runs with
  `--quiet`, so a rule at `warn` reports nothing: every rule is `error` or
  absent, and a registered rule nobody enables is a rule that checks nothing.

  @unit
  Scenario: No rule is configured at warn
    Given the architecture config and the root config
    When every declared severity is read
    Then none of them is warn

  @unit
  Scenario: Every registered rule is enabled
    Given the plugin registry
    When it is compared with the langwatch rules the configs enable at error
    Then every registered rule is enabled

  @unit
  Scenario: Every configured langwatch rule is registered
    Given the langwatch rules the configs name
    When they are compared with the plugin registry
    Then each one is registered

  @unit
  Scenario: The registry keys each rule by its own declared name
    Given the plugin registry
    When each entry is read
    Then its key is the name its defineRule declaration carries

  @unit
  Scenario: A should-prefixed test title is refused by vitest/valid-title
    Given the root config
    When the vitest/valid-title setting is read
    Then it is an error whose mustNotMatch refuses a leading "should" on it and test titles
