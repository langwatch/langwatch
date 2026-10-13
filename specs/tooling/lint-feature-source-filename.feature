Feature: The feature-source-filename lint rule
  A strict feature source file is named lower kebab case with dotted
  architectural qualifiers — `<subject>.<artifact>.ts` — so its filename
  alone says what it is.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A misnamed strict source file is reported with the allowed artifacts
    Given a strict feature service file named in PascalCase
    When the feature-source-filename rule runs over it
    Then it reports filename naming the file and listing the allowed artifacts

  @unit
  Scenario: A misnamed strict source file names the exact renamed target
    Given a strict feature service file named in PascalCase with the artifact repeated
    When the feature-source-filename rule runs over it
    Then the message names the kebab-case filename to rename it to

  @unit
  Scenario: A filename with no recognizable artifact falls back to the closed list
    Given a strict feature file whose name carries no known artifact
    When the feature-source-filename rule runs over it
    Then the message lists the artifacts to pick from

  @unit
  Scenario: A qualifier-prefixed process filename names the dot-separated rename
    Given a repository file whose backend qualifier is hyphen-joined to its subject
    When the feature-source-filename rule runs over it
    Then the message names the rename with the qualifier in its own dot segment

  @unit
  Scenario: A correctly named strict source file is left alone
    Given a strict feature service file named in lower kebab case
    When the feature-source-filename rule runs over it
    Then it reports nothing
