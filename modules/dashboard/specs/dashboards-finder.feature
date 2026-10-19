Feature: Dashboards finder: templates and widgets filed by what the member wants
  As a project member
  I want to find a dashboard or a widget by what I want from my agent, and by the kind of
  agent I run
  So that I start from a board that answers my question, not from a blank page

  # Owner decisions, 2026-10-06 and 2026-10-07 (langwatch/tasks#911, prototype pass 7).
  # The templates finder and "Add a widget" share one search, one category chip row and one
  # agent-type chip row. AC100-AC107d and AC130-AC138 in dashboards-v2.feature cover the
  # parts both had before; these scenarios cover what is new.

  @unit
  Scenario: Finder: categories are the verbs Grow, Protect, Profit and Trust
    Given the dashboards catalogue
    Then its categories are Grow, Protect, Profit and Trust, in that order
    And every question of the question tree sits on one branch, and every branch on one category
    And every template and every widget is filed by the question tree

  @integration
  Scenario: Finder: a category chip with nothing in it is not shown
    Given the finder or "Add a widget" narrowed so that a category holds nothing
    Then that category has no chip, unless it is the one picked
    And no chip reads 0

  @unit
  Scenario: Finder: a per-kind widget list is its own focus template
    Given a template with its own widgets for some agent kinds
    Then each of those lists is its own template named "<Base>: <kind> focus", listed after its base
    And the base keeps its id, and each focus template has its own id made from the base's and the kind
    And a focus template asks Langy for a report on its own widgets
    And a project of that kind gets the focus template preloaded in place of the base
    And a template preloaded for only one agent kind is a focus template for that kind
    # Decision: templates may share widgets; there are no "Also:" links between templates

  @unit @integration
  Scenario: Finder: coming-soon, coding-agent and org-wide templates are hidden
    Given the templates finder
    Then a template with any widget that has no code is not listed
    And the coding-agent boards and the org-wide board are not listed
    And a From LangWatch board still opens when its template is not built yet

  @unit @integration
  Scenario: Finder: an agent-type chip finds only the templates made for that type
    Given the agent-type chips, one for each type with a template made for it
    When the member picks one
    Then only the templates made for that type are listed, each naming the type in its footer
    And the board a template makes still covers the whole project

  @integration
  Scenario: Finder: a picked category turns the header into its question and pitch
    When the member picks a category in the templates finder
    Then the header shows the category, the question it answers and what its templates are for

  @unit
  Scenario: Finder: Add a widget leaves out coding-agent widgets
    Given "Add a widget"
    Then no widget made for coding agents, or reading coding-agent traces, is listed

  @unit
  Scenario: Copy: no question, title or category says a bare it
    Then every category question, branch, catalogue question, widget title, template name and
      job, and suggested question names its subject: "Can my agent hurt me?", never "Can it hurt me?"
    # Owner list, 2026-10-08: never a bare "it" in questions or copy

  @integration
  Scenario: Finder: Add a widget's I'll build it myself hands over to the widget editor
    Given "Add a widget" is open on a board
    When the member presses "I'll build it myself", spelled out on the button, not in a tooltip
    Then the picker hands over to the widget editor for a new widget
    And no widget is added, and the picker asks Langy nothing: the editor sends the starting prompt
