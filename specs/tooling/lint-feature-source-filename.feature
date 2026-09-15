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
  Scenario: A correctly named strict source file is left alone
    Given a strict feature service file named in lower kebab case
    When the feature-source-filename rule runs over it
    Then it reports nothing
