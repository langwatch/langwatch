Feature: Instant Evals answers an LLM-as-a-judge evaluator as its model

  As a customer with an LLM judge on a monitor, guardrail, experiment or evaluation
  I want to pick Instant Evals as the judge's model
  So that the judge runs without my own provider key and is billed per trace judged

  Issue: tasks#915, wave 1. ADR-173.

  The shape:
  - The evaluation module turns the judge's settings into one classifier question, and maps
    the verdict back to the result shape the judge returns today.
  - Instant Evals answers one judge call: check the budget, classify, price, record one spend row.
  - An organization the meter does not bill may spend one dollar in total.

  Rule: A judge with Instant Evals as its model is answered by Instant Evals

    @unit
    Scenario: A boolean judge on Instant Evals is classified, not sent to the evaluator service
      Given a boolean judge whose model is Instant Evals
      When a trace is evaluated
      Then Instant Evals answers it once
      And the evaluator service is not called

    @unit
    Scenario: A judge on any other model is unchanged
      Given a boolean judge whose model is a provider model
      When a trace is evaluated
      Then the evaluator service answers it as today
      And Instant Evals is not called

  Rule: The question keeps what the judge's prompt points at

    @unit
    Scenario: Input, output and contexts are labelled sections
      Given a judge mapped to an input, an output and two contexts
      When its question is built
      Then the text holds an input section, an output section and a contexts section

    @unit
    Scenario: A long input does not push out the output
      Given an input far longer than the classifier's limit and a short output
      When its question is built
      Then the text fits the limit
      And the output section is kept whole

  Rule: The result keeps today's shape and scale

    @unit
    Scenario: A fail-condition prompt keeps its polarity
      Given a boolean judge whose prompt says "return false if it mentions a competitor"
      And the classifier finds the instructions call for false
      When the result is mapped
      Then the judge does not pass
      And its score is 0

    @unit
    Scenario: A boolean judge passes when true is the likely answer
      Given the classifier gives true a probability of 0.82
      When the result is mapped
      Then the judge passes with score 1
      And its details read "Instant Evals: true, 82% confident"

    @unit
    Scenario Outline: A score judge returns on its own range
      Given a score judge with range <min> to <max>
      When the classifier answers at the top of the scale
      Then the score is <max>

      Examples:
        | min | max |
        | 0   | 1   |
        | 1   | 5   |
        | 0   | 100 |

    @unit
    Scenario: A score judge saved before the range setting reads as 0 to 1
      Given a score judge with no range in its settings
      When its question is built
      Then it is scored from 0 to 1

    @unit
    Scenario: A category judge returns the most likely category
      Given a category judge with categories "refund" and "complaint"
      And the classifier gives "refund" the highest probability
      When the result is mapped
      Then the label is "refund"
      And passed is not set

  Rule: Every skip has a status

    @unit
    Scenario Outline: A classifier skip maps to a result status
      Given the classifier skips with <reason>
      When the result is mapped
      Then the result status is <status>

      Examples:
        | reason         | status  |
        | input_too_large | skipped |
        | not_configured | error   |
        | rate_limited   | error   |
        | failed         | error   |

    @unit
    Scenario: A judge with no content to judge is skipped
      Given a judge whose mapped input and output are empty
      When a trace is evaluated
      Then the result is skipped
      And Instant Evals is not called

  Rule: One judge call is one spend row, once

    @unit
    Scenario: A judge call records one spend row priced for the customer
      Given a judge call that classified five hundred input tokens
      When it finishes
      Then one spend row is recorded with the customer price
      And the result's cost is that price

    @unit
    Scenario: A judge call that used no tokens records nothing
      Given a judge call the classifier skipped
      When it finishes
      Then no spend row is recorded

    @unit
    Scenario: A redelivered evaluation is billed once
      Given an evaluation command whose judge call succeeded
      And recording its outcome failed once
      When the command is delivered again
      Then the ledger holds one spend row for it

    @unit
    Scenario: The trace search bar stays unmetered
      Given a sentence routed by the trace search bar
      When it is classified
      Then no spend row is recorded

  Rule: Only usage-billed organizations judge past one dollar

    @unit
    Scenario: A free organization past one dollar is refused before classifying
      Given a free organization that has spent one dollar
      When a judge call arrives
      Then it is refused with the free budget exhausted error
      And the classifier is not called

    @unit
    Scenario: A paid organization on tiered pricing is capped at one dollar
      Given a paid organization the meter does not bill
      And it has spent one dollar
      When a judge call arrives
      Then it is refused with the free budget exhausted error

    @unit
    Scenario: A usage-billed organization is not capped
      Given an organization the meter bills
      And it has spent one dollar
      When a judge call arrives
      Then it is classified

  Rule: The picker offers Instant Evals behind the release flag

    @integration
    Scenario: The judge model picker shows Instant Evals when released
      Given a project with release_instant_evals on
      When a member opens the model picker on an LLM judge
      Then Instant Evals is one of the options

    @integration
    Scenario: The judge model picker hides Instant Evals when not released
      Given a project with release_instant_evals off
      When a member opens the model picker on an LLM judge
      Then Instant Evals is not an option
