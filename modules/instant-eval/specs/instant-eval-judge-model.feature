Feature: Instant Evals answers an LLM-as-a-judge evaluator as its model

  As a customer with an LLM judge on a monitor, guardrail, experiment or evaluation
  I want to pick Instant Evals as the judge's model
  So that the judge runs without my own provider key and is billed per trace judged

  Issue: tasks#915, wave 1. ADR-174.

  The shape:
  - The evaluation module turns the judge's settings into one classifier question, and maps
    the verdict back to the result shape the judge returns today.
  - The Instant Evals judge, a small shared module, answers one judge call: check the budget,
    classify, record one spend row priced for the customer. The meter, the pricing rule and the
    $1 check already exist and are reused. The spend row lands in the ledger the meter reads.
  - The judge runs on LangWatch cloud only, with LangWatch's key.
  - A judge call from an organization the meter does not bill may spend one dollar in total.
    Calls admitted together may run it slightly past, and every one of them is recorded.
    Instant Evals runs and judged queries keep today's free-plan rule in wave 1.

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
      And its details name <reason>

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
    Scenario Outline: A refused judge is an error with the reason
      Given <refusal>
      When a trace is evaluated by a judge on Instant Evals
      Then the result status is error
      And its details name the <code> code
      And the refusal is returned as a result, not thrown

      Examples:
        | refusal                                                 | code                  |
        | an organization whose free budget is spent              | free budget exhausted |
        | a project the Instant Evals judge has not learned yet   | project unknown       |

    @unit
    Scenario Outline: The refusal's error code is kept in the reported result
      Given a judge result that is an error with the <code> code
      When the evaluation's outcome is reported
      Then the reported error text names the <code> code

      Examples:
        | code                  |
        | free budget exhausted |
        | project unknown       |

    @integration
    Scenario: A refused monitor evaluation is stored as an error naming its code
      Given a monitor whose judge is on Instant Evals
      And an organization whose free budget is spent
      When the monitor evaluates a trace
      Then the stored evaluation is an error
      And its error text names the free budget exhausted code

    @unit
    Scenario: Off LangWatch cloud a judge call is not configured
      Given an install that is not LangWatch cloud
      And a classifier key is set
      When a judge call arrives
      Then it is answered as classifier not configured
      And the classifier is not called

    @unit
    Scenario: The not configured copy never asks for a key of one's own
      Given the copy shown when Instant Evals is not configured
      Then the error tip, the error message and the error copy the customer reads each never mention adding or setting a key
      And none of them names JEV_API_KEY

    @unit
    Scenario: A guardrail check on the stream chunk direction is skipped
      Given a judge on Instant Evals
      When a guardrail check evaluates it on the stream chunk direction
      Then the result is skipped with the reason in its details
      And Instant Evals is not called

    @unit
    Scenario: A guardrail passes its direction to the evaluation
      Given a guardrail check from the gateway
      When it is turned into an evaluation
      Then the evaluation carries the check's direction

    @integration
    Scenario: A stream chunk sent through the gateway's guardrail check never reaches the classifier
      Given a fail-closed guardrail whose judge is on Instant Evals
      When the gateway's guardrail service checks a chunk of a streamed reply through the evaluation's guardrail check
      Then the evaluation result is skipped
      And the chunk is allowed
      And the classifier is never called

    @unit
    Scenario Outline: A guardrail check on the request or response direction is judged
      Given a judge on Instant Evals
      When a guardrail check evaluates it on the <direction> direction
      Then Instant Evals answers it once

      Examples:
        | direction |
        | request   |
        | response  |

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
    Scenario: A project the judge does not know yet is refused, never judged free
      Given a LangWatch cloud install
      And a project the Instant Evals judge has not learned
      When a judge call arrives
      Then it is refused with the project unknown error, returned rather than thrown
      And the classifier is not called
      And no priced event is appended

    @integration
    Scenario: A run's and a judged query's spend reach the judge's total
      Given a free organization
      When a run records $0.50 and a judged query records $0.25 through the Instant Evals judge
      Then the judge's spend for it is $0.75

    @integration
    Scenario: Judge spend in the ledger counts against a run
      Given a free organization whose judge calls were priced at $1.00 in total
      And the gateway wrote their spend rows from the judge's priced events
      When an Instant Evals run starts
      Then the ledger rows carry the Instant Evals request type under the judged project
      And the run is refused with the free budget exhausted error

    @unit
    Scenario Outline: Runs and judged queries record spend under the organization Instant Evals resolves
      Given a project the Instant Evals judge has not learned, in an organization Instant Evals resolves
      When an Instant Evals <work> records its spend through the judge
      Then the record carries that organization
      And the judge is never asked to look up the project

      Examples:
        | work         |
        | run          |
        | judged query |

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

    @unit
    Scenario: A paid organization on tiered pricing keeps today's run rules in wave 1
      Given a paid organization the meter does not bill that has spent one dollar on Instant Evals
      And the judge holds no billing row for it
      When it starts a run
      Then the run is accepted
      And the judge's usage billing copy is never read

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

  Rule: Catch-up jobs fill the judge's copies right after the rollout

    @integration
    Scenario: The project catch-up records every existing project's created fact
      Given projects created before the judge existed
      And a project whose created fact failed to write
      When the project catch-up runs twice
      Then the judge knows each project's organization
      And each project appears once

    @unit
    Scenario: A failed project created fact logs the catch-up that recovers it
      Given recording a new project's created fact fails
      When the failure is logged
      Then the log names the backfill-project-created catch-up

    @integration
    Scenario: The usage-billing catch-up gives every organization's answer
      Given an organization the meter bills today
      And an organization the meter does not bill
      When the usage-billing catch-up runs twice
      Then the judge reads the first as usage billed and the second as not
      And the judge holds one billing row for each

    @integration
    Scenario: A billing change after the catch-up is kept
      Given the usage-billing catch-up marked an organization usage billed
      When billing later reports it is no longer usage billed
      Then the judge reads it as not usage billed

    @integration
    Scenario Outline: A catch-up read before a billing change never overrides it
      Given billing stopped billing an organization and stamped that fact after saving it
      And the usage-billing catch-up read billing <read> that change
      When the judge folds both facts, <order>
      Then the judge reads it as not usage billed

      Examples:
        | read   | order               |
        | before | real fact first     |
        | before | catch-up fact first |
        | after  | real fact first     |
        | after  | catch-up fact first |

    @integration
    Scenario: A re-run usage-billing catch-up fixes a change the judge missed
      Given the judge reads an organization as usage billed from a real billing fact
      And billing stopped billing it while the judge's subscriber was not running
      When the usage-billing catch-up runs again
      Then the judge reads it as not usage billed

    @integration
    Scenario: The spend catch-up copies every ledger row once
      Given an organization with $0.40 of Instant Evals spend in the gateway ledger over two requests
      When the spend catch-up runs twice
      Then the judge's spend for it is $0.40
      And the judge holds one spend row for each request

    @integration
    Scenario: A re-run spend catch-up copies the spend old pods wrote during a rollback
      Given the judge holds $0.40 of spend for an organization
      And old pods wrote $0.20 more to the gateway ledger only, during a rollback
      When the spend catch-up runs again
      Then the judge's spend for it is $0.60

    @integration
    Scenario Outline: A request in both the ledger and the judge is counted once
      Given the gateway ledger holds a $0.10 Instant Evals request
      And the judge's priced event for the same request is folded <when> the spend catch-up runs
      Then the judge's spend for it is $0.10
      And the judge holds one spend row for that request

      Examples:
        | when   |
        | before |
        | after  |

    @integration
    Scenario: Two priced events for one request add one row
      Given the judge recorded a $0.10 priced event for a request
      When a second priced event with a new event id carries the same request id
      And the judge's spend is rebuilt from its events
      Then the judge's spend from that request is $0.10, both live and after the rebuild

    @unit
    Scenario: A retried run records its spend under the same request
      Given an Instant Evals run whose finish failed after recording its spend
      When the finish is retried, under another finish reason or on another pod
      Then the spend it records again carries the same request id as the first attempt

  Rule: The picker offers Instant Evals behind the release flag or the organization's opt-in

    @integration
    Scenario: The judge model picker shows Instant Evals when released
      Given a project with release_instant_evals on
      When a member opens the model picker on an LLM judge
      Then Instant Evals is one of the options

    @integration
    Scenario: The judge model picker shows Instant Evals to an organization that opted in
      Given a project with release_instant_evals off, in an organization that opted in to Instant Evals
      When a member opens the model picker on an LLM judge
      Then Instant Evals is one of the options

    @integration
    Scenario: The judge model picker hides Instant Evals when not released
      Given a project with release_instant_evals off, in an organization that has not opted in
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
