Feature: An evaluator says what it is
  As a person reading a workbench cell
  I want every evaluator chip to carry a name I can tell apart
  So that I know which score belongs to which check

  # A chip is the only place a row shows which check produced a score. The
  # workbench picker always records the database evaluator, so a chip added
  # from the page reads that evaluator's name. An agent adds an evaluator
  # through the action instead, records no database evaluator, and the chip
  # then fell all the way through to the raw config id: three chips reading
  # `evaluator_AzPF-HSd`, `evaluator_E27nxt8l` and `evaluator_I72w-XB4`.

  @unit
  Scenario: An agent must name the evaluator it adds
    When an agent adds an evaluator with no name
    Then the action is refused because the name is missing
    And the workbench holds no new evaluator

  @unit
  Scenario: Two evaluators of one type keep the names they were given
    Given an agent adds an exact match evaluator named "l1 exact match"
    And the agent adds a second exact match evaluator named "l2 exact match"
    Then the two evaluators carry their own names
    And neither name is the evaluator type

  @unit
  Scenario: A chip reads the evaluator type when no name is stored
    Given a saved experiment holds an evaluator of type "langevals/exact_match"
    And that evaluator carries no name and no database evaluator
    Then the chip reads "Exact Match Evaluator"
    And the chip never reads the config id

  @unit
  Scenario: A name set in the workbench wins over the type name
    Given an evaluator of type "langevals/exact_match" named "l3 exact match"
    Then the chip reads "l3 exact match"

  @unit
  Scenario: A database evaluator name wins over the type name
    Given an evaluator of type "langevals/exact_match" with no workbench name
    And it points at a database evaluator named "Category match"
    Then the chip reads "Category match"
