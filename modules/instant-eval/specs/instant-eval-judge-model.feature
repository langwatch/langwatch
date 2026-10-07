Feature: Instant Evals answers an LLM-as-a-judge evaluator as its model

  As a customer with an LLM judge on a monitor, guardrail, experiment or evaluation
  I want to pick Instant Evals as the judge's model
  So that the judge runs without my own provider key and is billed per trace judged

  Issue: tasks#915, wave 1. ADR-173.

  The shape:
  - The evaluation module turns the judge's settings into one classifier question, and maps
    the verdict back to the result shape the judge returns today.
  - Instant Evals answers one judge call: check the budget, classify, record one spend row
    priced for the customer.
  - An organization the meter does not bill may spend one dollar in total. Calls admitted
    together may run it slightly past, and every one of them is recorded.

  Rule: A judge with Instant Evals as its model is answered by Instant Evals

    @unit
    Scenario: A boolean judge on Instant Evals is classified, not sent to the evaluator service
      Given a boolean judge whose model is Instant Evals
      When a trace is evaluated
      Then Instant Evals answers it once
      And the evaluator service is not called
      And no model provider is looked up

    @unit
    Scenario: A judge on any other model is unchanged
      Given a boolean judge whose model is a provider model
      When a trace is evaluated
      Then the evaluator service answers it as today
      And Instant Evals is not called

    @unit
    Scenario: A queued evaluation passes its retry key to the judge call
      Given a boolean judge on Instant Evals run from a queued evaluation command
      When the trace is evaluated
      Then the judge call carries the command's retry key

  Rule: The question keeps what the judge's prompt points at

    @unit
    Scenario: Input, output and contexts are labelled sections
      Given a judge mapped to an input, an output and two contexts
      When its question is built
      Then the text holds an input section, an output section and a contexts section

    @unit
    Scenario: A long input does not push out the output
      Given an input far longer than the question leaves room for, and a short output
      When its question is built
      Then the text fits the room the question leaves
      And the output section is kept whole

    @unit
    Scenario: An output longer than the whole room is cut keeping both ends
      Given an output far longer than the question leaves room for
      When its question is built
      Then the text fits the room the question leaves
      And the output section keeps its first and its last lines

  Rule: The result keeps today's shape and scale

    @unit
    Scenario: A boolean question asks whether the instructions call for true
      Given a boolean judge whose prompt says "return false if it mentions a competitor"
      When its question is built
      Then the question carries the prompt as it was written
      And its two criteria are "the instructions call for true" and "the instructions call for false"

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
      When the classifier answers at the top of the scale it was asked
      Then the score is <max>

      Examples:
        | min | max |
        | 0   | 1   |
        | 1   | 5   |
        | 0   | 100 |

    @unit
    Scenario: A whole-number range of at most ten levels is asked directly
      Given a score judge with range 1 to 5
      When its question is built
      Then the question asks the levels 1 to 5

    @unit
    Scenario: Any other range is asked on 1 to 10
      Given a score judge with range 0 to 100
      When its question is built
      Then the question asks the levels 1 to 10

    @unit
    Scenario Outline: A range wider than ten levels, other than 0 to 1, returns whole numbers
      Given a score judge with range 0 to 10
      When the classifier answers <answer> on the levels 1 to 10
      Then the score is <score>

      Examples:
        | answer | score |
        | 2      | 1     |
        | 8      | 8     |

    @unit
    Scenario: A 0 to 1 range is a fraction and is not rounded
      Given a score judge with range 0 to 1
      When the classifier answers 5.5 on the levels 1 to 10
      Then the score is 0.5

    @unit
    Scenario: A score judge saved before the range setting reads as 0 to 1
      Given a score judge with no range in its settings
      When the classifier answers at the top of the scale it was asked
      Then the score is mapped onto 0 to 1
      And the score is 1

    @unit
    Scenario: A category judge returns the most likely category
      Given a category judge with categories "refund" and "complaint"
      And the classifier gives "refund" the highest probability
      When the result is mapped
      Then the label is "refund"
      And passed is not set

    @unit
    Scenario: The score judge's settings carry an optional range
      Given the generated settings of the score judge
      Then they hold an optional min and an optional max
      And neither has a default

  Rule: Every skip and refusal has a status

    @unit
    Scenario Outline: A classifier skip maps to a result status
      Given the classifier skips with <reason>
      When the result is mapped
      Then the result status is <status>

      Examples:
        | reason                     | status  |
        | classifier_input_too_large | skipped |
        | classifier_not_configured  | error   |
        | classifier_rate_limited    | error   |
        | classifier_failed          | error   |

    @unit
    Scenario: A judge with no content to judge is skipped
      Given a judge whose mapped input, output and contexts are empty
      When a trace is evaluated
      Then the result is skipped
      And Instant Evals is not called

    @unit
    Scenario: A judge refused by the free budget is an error with the reason
      Given an organization whose free budget is spent
      When a trace is evaluated by a judge on Instant Evals
      Then the result status is error
      And it carries the free budget exhausted error code
      And the refusal is returned as a result, not thrown

  Rule: One judge call is one spend row, once

    @unit
    Scenario: A judge call records one spend row priced for the customer
      Given a judge call that classified five hundred input tokens
      When it finishes
      Then one spend row is recorded with the customer price
      And the call answers that price beside the verdict

    @unit
    Scenario: The result's cost is the customer price
      Given a judge call answered with a price
      When the result is mapped
      Then the result's cost is that price in USD

    @unit
    Scenario: A judge call that used no tokens records nothing
      Given a judge call the classifier skipped
      When it finishes
      Then no spend row is recorded

    @unit
    Scenario: The same retry key gives the same spend id
      Given two judge calls with the same retry key
      When each records its spend
      Then both spend rows carry the same request id

    @unit
    Scenario: A redelivered evaluation is billed once
      Given an evaluation command whose judge call succeeded
      And recording its outcome failed once
      When the command is delivered again
      Then the ledger holds one spend row for it

    @unit
    Scenario: A judge call with no retry key gets a fresh spend id
      Given two judge calls with no retry key
      When each records its spend
      Then the two spend rows carry different request ids

    @unit
    Scenario: A guardrail check carries no retry key
      Given a guardrail whose judge is on Instant Evals
      When the gateway checks a request
      Then the judge call carries no retry key

    @unit
    Scenario: A judge call cancelled after the classifier answered still records its spend
      Given a judge call whose caller cancels after the classifier answered
      When it finishes
      Then one spend row is recorded

    @unit
    Scenario: A guardrail check writes one cost row
      Given a guardrail whose judge is on Instant Evals
      When the gateway checks a request
      Then one guardrail cost row is written with the customer price

    @unit
    Scenario: A too-large text retried smaller is billed for the attempt that answered
      Given a text the classifier refuses as too large once and answers when cut
      When it is classified
      Then the judgement carries the input tokens of the answered attempt alone

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

    @unit
    Scenario: A project with no organization is not capped
      Given a project that belongs to no organization
      When a judge call arrives
      Then it is classified

    @unit
    Scenario: A judge call that crosses one dollar is recorded in full
      Given a free organization that has spent $0.99
      When a judge call priced $0.05 is classified
      Then one spend row of $0.05 is recorded

    @unit
    Scenario: Two judge calls that arrive together just under one dollar are both answered
      Given a free organization one millionth of a dollar under one dollar
      When two judge calls, each priced more than one millionth of a dollar, arrive together
      Then both are classified
      And both spend rows are recorded

    @unit
    Scenario: A paid organization refused by the free budget is not told to upgrade
      Given a paid organization the meter does not bill that has spent one dollar
      When a judge call arrives
      Then it is refused with the free budget exhausted error
      And its message does not ask it to upgrade to a paid plan

    @integration
    Scenario: A paid organization the meter does not bill gets the free row cap
      Given a paid organization the meter does not bill
      When it starts a run asking for 100,000 rows
      Then it is refused with the row cap exceeded error
      And the error names a cap of 10,000 rows

  Rule: Billing says which organizations the meter bills

    @unit
    Scenario Outline: The meter's own rule answers whether an organization is usage billed
      Given an organization <state>
      When billing is asked whether the meter bills it
      Then the answer is <billed>

      Examples:
        | state                                                       | billed |
        | on usage pricing with a Stripe customer and a subscription  | yes    |
        | on usage pricing with no subscription                       | no     |
        | on usage pricing with no Stripe customer                    | no     |
        | on tiered pricing                                           | no     |
        | marked self-hosted with a connected billing account         | yes    |
        | that does not exist                                         | no     |

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

    @integration
    Scenario: A project with no model provider can still pick Instant Evals
      Given a project with release_instant_evals on and no model provider configured
      When a member opens the model picker on an LLM judge
      Then Instant Evals is one of the options

    @integration
    Scenario: The score range shows only for Instant Evals
      Given a score judge
      When a member picks Instant Evals as its model
      Then the score range fields are shown
      And they are hidden for any other model
