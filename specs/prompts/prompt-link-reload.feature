# A ?promptId= link stays in the address so it can be shared; reloading it must
# not open the same prompt twice.
#
# Implementation:
#   modules/prompt/browser/src/features/tabs/behavior/use-url-param-to-open-new-tab.ts

Feature: Reloading a prompt link focuses its open tab

  @integration
  Scenario: Reloading a promptId link focuses the tab already holding that prompt
    Given Prompt Studio has a tab open for the saved prompt "greeter"
    And another tab is the active one
    When the reader reloads a link carrying ?promptId= of "greeter"
    Then the "greeter" tab becomes the active tab
    And no second tab opens for "greeter"
