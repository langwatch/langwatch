Feature: Inline run parameters in situation text
  As a person who writes a scenario
  I want to write { key: value } in the situation text
  So that I create a run parameter with a default without a separate form.

  Background: decided by the owner in ADR-180.
    Single braces declare a parameter inline. Liquid with double braces keeps
    working as today. Mixing the two is a later upgrade, out of this series.
    The platform handles the single-brace form before Liquid.

  @unit @unimplemented
  Scenario: Saving a scenario declares the inline parameter
    Given a situation "The customer asks for a { refund_amount: 49.95 } refund"
    When the scenario is saved
    Then the scenario declares the run parameter "refund_amount" with the default "49.95"

  @unit @unimplemented
  Scenario: The default is used when the run gives no value
    Given a scenario with the inline parameter { loyalty_tier: gold }
    When a run starts with no value for "loyalty_tier"
    Then the situation reads "gold" in place of the declaration

  @unit @unimplemented
  Scenario: A value given to the run wins over the default
    Given a scenario with the inline parameter { loyalty_tier: gold }
    When a run starts with loyalty_tier "silver"
    Then the situation reads "silver"

  @integration @unimplemented
  Scenario: The run shows the value it used
    Given a run of a scenario with the inline parameter { loyalty_tier: gold }
    Then the run shows the parameter "loyalty_tier" with the value "gold"

  @unit @unimplemented
  Scenario: The same inline name twice must agree on the default
    Given a situation with { tier: gold } and { tier: silver }
    When the scenario is saved
    Then the save is refused with a message naming "tier"

  @unit @unimplemented
  Scenario: An inline parameter reaches the agent and the hooks like any run parameter
    Given a scenario with the inline parameter { loyalty_tier: gold }
    When setup, a turn and teardown are called
    Then each receives loyalty_tier "gold"

  @unit @unimplemented
  Scenario Outline: A brace that is not a key and value declaration stays as text
    Given a situation containing "<text>"
    When the scenario is saved
    Then no run parameter is declared from it
    And the situation text is left unchanged

    Examples:
      | text                         |
      | Reply in {json} only         |
      | Send { "a": 1 } to the API   |
      | Use { } for empty            |
      | Open { unclosed              |

  @unit @unimplemented
  Scenario: Liquid parameters keep working
    Given a situation "Tier is {{ params.loyalty_tier }}"
    When a run starts with loyalty_tier "gold"
    Then the situation reads "Tier is gold"

  @unit @unimplemented
  Scenario: The single-brace form never reaches liquidjs
    Given a situation with { key: value } and no double braces
    When the situation is rendered
    Then liquidjs raises no TokenizationError

  @unit @unimplemented
  Scenario: A situation that mixes both forms is not given a new meaning
    Given a situation with { key: value } and {{ params.other }}
    When the scenario is saved
    Then the Liquid part behaves as today
