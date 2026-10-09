Feature: Prompt playground opens tabs on pages served over plain HTTP
  As a self-hoster who serves LangWatch over plain HTTP on an intranet address
  I want the prompt playground to open prompts
  So that the browser lacking crypto.randomUUID does not stop me from using it

  @regression @unit
  Scenario: Opening prompt tabs works without crypto.randomUUID
    Given the page is served over plain HTTP and the browser has no crypto.randomUUID
    When I open a prompt, open a second one, and split a tab into a new window
    Then each prompt opens in a tab of its own
