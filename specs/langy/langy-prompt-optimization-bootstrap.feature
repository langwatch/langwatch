Feature: Langy bootstraps a workbench that is missing pieces
  As a user with only a prompt, or only a goal
  I want Langy to set up the dataset and evaluator the loop needs
  So that improvement can start from whatever I have

  # Taught by skills/prompt-optimization/SKILL.mdx (bootstrap branches and the
  # evaluator inference table). Judge-graded conversations:
  # platform/app/e2e/langy/langy-optimization-bootstrap.scenario.test.ts.

  @e2e
  Scenario: With a prompt but no dataset, Langy offers to generate an example dataset
    Given an experiment with a prompt target and an empty dataset
    When the user asks Langy to test or improve the prompt
    Then Langy offers to generate an example dataset before improving
    And previews rows before adding them all

  @e2e
  Scenario: The generated bootstrap dataset is sized for iteration and matches the bot's real users
    When Langy generates the bootstrap dataset
    Then it holds between fifteen and twenty five rows
    And the rows read like this bot's real users, not trivia

  @e2e
  Scenario: Classification-like golden answers get exact match on the golden column
    Given a dataset whose expected outputs are short labels
    When Langy picks an evaluator
    Then it adds exact match wired to the golden column

  @e2e
  Scenario: Free-text golden answers get the LLM answer match evaluator
    Given a dataset whose expected outputs are free text
    When Langy picks an evaluator
    Then it adds the LLM answer match evaluator with input, output and expected output wired

  @e2e
  Scenario: A contexts column gets faithfulness with contexts wired
    Given a dataset with a contexts column
    When Langy picks an evaluator
    Then it considers faithfulness and wires the contexts field

  @e2e
  Scenario: A named quality dimension with no golden gets a judge evaluator naming that dimension
    Given the user names a quality they care about and no golden answers exist
    When Langy picks an evaluator
    Then it proposes an LLM judge whose prompt names exactly that dimension

  @e2e
  Scenario: No golden answer at all gets a comparison between baseline and candidate
    Given a dataset with inputs only
    When Langy sets up scoring for the loop
    Then it adds a comparison judge between the baseline and the candidate
    And the comparison is configured without a golden answer

  @e2e
  Scenario: An ambiguous goal is asked as a choices card before anything changes
    Given the user's goal could mean more than one kind of better
    When Langy assesses the workbench
    Then it asks with a choices card naming the concrete alternatives
    And changes nothing until the user answers

  @e2e
  Scenario: The evaluator slug comes from evaluator types, never from memory
    When Langy adds any evaluator
    Then the type slug was read from the evaluator catalog in this conversation
