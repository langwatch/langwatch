Feature: The banned-test-model-names lint rule
  A test, fixture, scenario or seed that names a specific OpenAI model picks
  one that is cheap and capable so the suite stays affordable to run
  (CLAUDE.md mandates `gpt-5-mini`). The rule watches test directories,
  `.test.`, `.fixture.` and `.scenario.` files, and everything under
  `specs/`, for a retired or overpriced model name in a string or template
  literal; production source is ungoverned, since a gateway's own provider
  catalogue legitimately lists every model a provider ships. It carries an
  autofix that rewrites the matched substring to `gpt-5-mini` in place,
  except where the literal is the value of a `regex:` property — a matching
  pattern anchored to a specific catalog or price-table row, not prose, where
  a mechanical substitution would silently change what the pattern matches.

  `modules/model-provider` is ungoverned entirely, tests included, for the same
  reason its production source is: the model catalogue is its subject. Its tests
  name real models because the name is the value under test rather than a choice
  of who to call — they normalise `GPT-4O` to `gpt-4o`, strip a `-fp8` suffix
  back to the id it qualifies, and assert a named model's per-token price. None
  of them calls a model, so none can cost anything, and rewriting the literal
  would assert the wrong price against the wrong name.

  @unit
  Scenario: A gpt-4o literal in a test is a failure
    Given a test file with a string literal naming gpt-4o
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName naming gpt-4o

  @unit
  Scenario: A gpt-4o-mini literal is reported under its own name
    Given a test file with a string literal naming gpt-4o-mini
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName naming gpt-4o-mini, not gpt-4o

  @unit
  Scenario: A gpt-3.5-turbo literal in a fixture is a failure
    Given a fixture file with a string literal naming gpt-3.5-turbo
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName naming gpt-3.5-turbo

  @unit
  Scenario: A gpt-5-mini literal is allowed
    Given a test file with a string literal naming gpt-5-mini
    When the banned-test-model-names rule runs over it
    Then it reports nothing

  @unit
  Scenario: A provider catalogue in production source is not governed
    Given a production source file with a string literal naming gpt-4o
    When the banned-test-model-names rule runs over it
    Then it reports nothing

  @unit
  Scenario: The model catalogue's own tests may name real models
    Given a test file under modules/model-provider naming gpt-4o
    When the banned-test-model-names rule runs over it
    Then it reports nothing

  @unit
  Scenario: The exemption is the catalogue's alone
    Given the same literal in a test file of any other module
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName naming gpt-4o

  @unit
  Scenario: A banned model literal is rewritten to gpt-5-mini
    Given a bare string literal naming a banned model
    When the fixer runs
    Then the literal is rewritten to gpt-5-mini

  @unit
  Scenario: A banned model name inside a longer string is rewritten in place
    Given a string literal that names a banned model inside a longer sentence
    When the fixer runs
    Then only the matched substring is replaced, and the rest of the string is unchanged

  @unit
  Scenario: Two banned names in one literal are both rewritten
    Given a string literal naming two different banned models
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName twice, once for each name
    And the fixer replaces both occurrences

  @unit
  Scenario: A template literal naming a banned model is rewritten
    Given a template literal with no interpolation naming a banned model
    When the fixer runs
    Then the quasi is rewritten to gpt-5-mini

  @unit
  Scenario: A template literal interpolation next to a banned name is left untouched
    Given a template literal whose quasi after an interpolation names a banned model
    When the fixer runs
    Then only the literal text is rewritten, and the interpolated expression is untouched

  @unit
  Scenario: The rewritten literal reports nothing
    Given the output of a previous fix
    When the banned-test-model-names rule runs over it again
    Then it reports nothing

  @unit
  Scenario: A model name with no word boundary is left alone
    Given a string literal where the banned name has no word boundary around it
    When the banned-test-model-names rule runs over it
    Then it reports nothing

  @unit
  Scenario: A dated model id is a different model and is left alone
    Given a test file naming gpt-4o-2024-08-06 and gpt-4.1.2
    When the banned-test-model-names rule runs over it
    Then it reports nothing, and the autofix never produces gpt-5-mini-2024-08-06

  @unit
  Scenario: A banned name before a closing period is still reported
    Given a test file whose string ends a sentence with gpt-4o
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName naming gpt-4o on that line

  @unit
  Scenario: A banned model name inside a regex pattern is reported without a rewrite
    Given a `regex:` property value that anchors a banned model name as a matching pattern
    When the banned-test-model-names rule runs over it
    Then it reports bannedModelName
    But the fixer leaves the literal unchanged
