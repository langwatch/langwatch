Feature: Which classifier the Instant Evals judge holds

  As the platform
  I want the judge's classifier built by its channel tier from config and secrets
  So that only LangWatch Cloud with LangWatch's key ever sends text to the classifier

  @unit
  Scenario: A process on the memory tier holds no classifier
    Given the judge installed on the memory tier
    When its channels are built
    Then it holds no classifier and a classify call answers classifier_not_configured

  @unit
  Scenario: LangWatch Cloud without the classifier key holds no classifier
    Given the judge installed on the live tier on LangWatch Cloud with no JEV_API_KEY
    When its channels are built
    Then it holds no classifier
