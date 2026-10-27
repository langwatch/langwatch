Feature: Dataset size bounds follow an organization's own per-file limit
  As an operator
  I want to raise one organization's largest dataset file
  So that its datasets of large images fit without changing the limits of anyone else

  Every dataset size bound is derived from the largest file an image or file
  cell accepts. The default is 20 MB. An operator can raise it for one
  organization from the back office, and the organization then answers the same
  derivation over its own number.

  @unit @entitlements
  Scenario: An organization whose per-file limit was raised answers the raised dataset bounds
    Given an operator raised an organization's largest dataset file to 100 MB
    When a module asks for that organization's dataset size bounds
    Then the largest file answers 100 MB
    And the row, upload and read bounds answer what a 100 MB file derives

  @unit @entitlements
  Scenario: Raising one organization's per-file limit leaves every other organization on the defaults
    Given an operator raised one organization's largest dataset file to 100 MB
    When a module asks for another organization's dataset size bounds
    Then every dataset size bound answers its default

  @unit @entitlements
  Scenario: An organization with no override answers the default dataset bounds
    Given no operator set a largest dataset file for an organization
    When a module asks for that organization's dataset size bounds
    Then the largest file answers 20 MB
    And every other dataset size bound answers its default

  @unit @entitlements
  Scenario: A raised per-file limit changes only the dataset size bounds
    Given an operator raised an organization's largest dataset file to 100 MB
    When a module asks for a bound that is not a dataset size bound
    Then the bound answers what it answers for every organization on that plan
    And the organization's per-file limit is not read

  @unit @entitlements
  Scenario: The larger of the deployment's bound and the organization's raised bound answers
    Given the deployment configures its own number for a dataset size bound
    And an operator raised an organization's largest dataset file
    When a module asks for that bound
    Then the organization answers the larger of the two numbers
    And an organization with no limit of its own answers the deployment's number

  @unit @entitlements
  Scenario: A stored per-file limit outside the allowed range is held to the range
    Given an organization's stored largest dataset file is below 20 MB or above 1024 MB
    When a module asks for that organization's largest dataset file
    Then a value below the default answers 20 MB
    And a value above the ceiling answers 1024 MB
