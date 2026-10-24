Feature: Langy scenario suite for Dashboards and Insights
  As the owner of the Langy in-product assistant
  I want judge-graded scenarios over a project with known traffic
  So that a chart or finding Langy makes is checked against the planted totals

  # Judge-graded conversations:
  # apps/ui/e2e/langy/langy-dashboards.scenario.test.ts. The world and the
  # traffic they read are in apps/ui/e2e/langy/dashboards-world.ts and
  # traffic-pattern.ts.

  @e2e
  Scenario: Chart from a question
    Given a project seeded with traces that have known totals
    When a user asks Langy for a chart of those totals
    Then a widget is on the board
    And its query returns the planted totals
