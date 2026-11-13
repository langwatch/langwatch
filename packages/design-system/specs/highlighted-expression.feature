Feature: Filter expressions read with syntax highlighting
  As someone reading or writing a filter expression
  I want its fields, strings, operators and joining words told apart by colour
  So that I can read what it selects at a glance and spot a typo as I type

  @unit
  Scenario: An expression splits into tokens that join back to the text
    Given the expression 'attributes["orchestrator"] == "web" and Verified("orchestrator")'
    Then it splits into a field, punctuation, strings, an operator, a keyword and a function call
    And the tokens joined are exactly the expression

  @unit
  Scenario: An unfinished expression still highlights
    Given the expression 'attributes["orch'
    Then the unclosed string runs to the end of the text

  @integration
  Scenario: A highlighted expression keeps its whole text
    Given the expression 'name == "web" or attributes["k"] != nil'
    Then it renders in a code element whose text and title are the whole expression
    And the joining word and the strings are drawn in their own spans

  @integration
  Scenario: The expression editor highlights what is typed and underlines a marked span
    Given an expression editor holding 'attributes["k"] >= 3'
    And the span ">=" is marked
    Then the layer under the textarea shows the same text, coloured
    And the marked span is underlined
