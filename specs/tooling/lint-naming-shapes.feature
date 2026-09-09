# The ast-grep half of ADR-139: names and delegations that hide what a call
# answers with. The rules are matched against real code by the ast-grep CI
# job; this spec is bound to the fixture gate, which is what keeps a rule from
# silently going dead. Two rules that used to live here duplicated an enabled
# plugin rule and were deleted under ADR-135's class-A migration:
# `no-try-prefixed-name` (= `langwatch/fallible-result-naming`) and
# `no-same-name-delegation` (= `langwatch/layer-class`).

Feature: The linter refuses a name that hides the answer
  As a platform maintainer
  I want a name to agree with the return type it sits above
  So that a reader learns the absence contract from the signature

  Background:
    Given the committed ast-grep rules and their fixtures under dev/lint/ast-grep

  Rule: `require-boolean-name-prefix` refuses a boolean with no is, has, should, can or will

    @unit
    Scenario: The boolean prefix rule keeps a fixture and names the prefixes it accepts
      Given the require-boolean-name-prefix rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused boolean name and an accepted one
      And the rule's message names the prefixes a boolean may carry

  Rule: `no-identity-function` refuses a named function that returns its own argument

    @unit
    Scenario: The identity function rule keeps a fixture and says it adds no behaviour
      Given the no-identity-function rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused function and an accepted one
      And the rule's message calls it an identity function
