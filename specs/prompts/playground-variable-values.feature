Feature: Variable values in the prompt playground
  As a person trying a prompt in the playground
  I want the value of a variable to grow with what I type
  So that a long value reads in full instead of scrolling inside one line

  @integration
  Scenario: A variable value opens one line tall and grows with its text
    Given a prompt with a variable "question" in the playground
    When the value of "question" is read
    Then it is a text area one line tall, level with the rest of the row
    And it grows with the text up to a limit, then scrolls
    And it keeps the monospace type of the row
