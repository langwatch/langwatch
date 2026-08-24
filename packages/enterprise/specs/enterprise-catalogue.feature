Feature: Enterprise package catalogue

  Scenario: Discover an installed Enterprise feature contract
    Given the portable Enterprise catalogue is created
    When a caller asks for the licensing feature
    Then the catalogue identifies its portable contract and server package

  Scenario: Import the catalogue without runtime registration
    When an application imports the Enterprise catalogue
    Then no feature is registered and no environment is read
