Feature: A module asks the owner's error class, never spells a peer's error code
  As a maintainer
  I want a module that reacts to another module's handled error to ask that module's error class
  So that the owner can rename or split a code without a silent literal elsewhere going stale

  See dev/docs/plans/platform-architecture-blocks.md rule 2 and its idiom (Alex, 2026-10-20).
  Each handled error class in a module contract declares `static readonly code = "<code>" as const`,
  and `HandledError.is(error)` matches the class in process and a serialised payload of its code
  in the browser. A fix rule: main runs at zero and the policy blocks in CI.

  @unit @architecture
  Scenario: Comparing an error to a peer module's code is reported
    Given module a's contract declares WidgetMissingError with the static code "widget_missing"
    And module b compares error.code to "widget_missing" with === in one file and !== in another
    When the foreign-error-code policy reads the tree
    Then it reports both comparisons in module b

  @unit @architecture
  Scenario: A peer's code as a case label, a record key, a membership list or a const is reported
    Given module a's contract declares WidgetMissingError with the static code "widget_missing"
    And an app switches on the code with case "widget_missing"
    And module b keys a record by widget_missing
    And module b lists "widget_missing" in a Set, in a list it tests with includes and in an includes call
    And module b binds "widget_missing" to a const
    When the foreign-error-code policy reads the tree
    Then it reports every one of those literals

  @unit @architecture
  Scenario: A peer's code tested with some or find, or handed to a code-matching helper, is reported
    Given module a's contract declares WidgetMissingError with the static code "widget_missing"
    And module b tests a list holding "widget_missing" with some and another with find
    And module b calls a helper named like hasCode or errorChainHas with the error and "widget_missing"
    When the foreign-error-code policy reads the tree
    Then it reports the lists as membership and the helper argument as a comparison
    And a peer's code handed to a function not named for matching a code is not reported

  @unit @architecture
  Scenario: The owner's own code, a peer's code as plain text and test files are not reported
    Given module a's contract declares WidgetMissingError with the static code "widget_missing"
    And module a's process compares error.code to "widget_missing"
    And module b logs the text "widget_missing" and lists it in an array nothing tests
    And module b switches on another union's tag that happens to spell "widget_missing"
    And module b's unit test compares error.code to "widget_missing"
    When the foreign-error-code policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: Generic codes and the services' generated codes are not module-owned
    Given packages/handled-error declares the code "widget_invalid"
    And the generated Go codes declare "widget_gone"
    And module a's contract declares classes with the static codes "widget_invalid" and "widget_gone"
    When module b compares error.code to "widget_invalid" and to "widget_gone"
    Then the foreign-error-code policy reports nothing

  @unit @architecture
  Scenario: A foreign error code finding names the class and the contract to import
    Given module b compares error.code to module a's code "widget_missing"
    When the foreign-error-code policy reports it
    Then the message tells the author to import WidgetMissingError from @langwatch/a-contract and use WidgetMissingError.is(error)
    And a record key finding tells the author to key the record by [WidgetMissingError.code]

  @unit @architecture
  Scenario: A framework package declaring a module's code is named as a second import
    Given module a's contract declares WidgetMissingError with the static code "widget_missing"
    And packages/widgets declares FrameworkWidgetMissingError with the same static code
    And packages/widgets alone declares "widget_framework_only"
    When module b compares error.code to "widget_missing" and to "widget_framework_only"
    Then the policy reports only "widget_missing", naming WidgetMissingError first and FrameworkWidgetMissingError second
