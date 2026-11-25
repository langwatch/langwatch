Feature: The studio's quiet NLP Lambda functions are swept on a schedule
  As the operator of a LangWatch deployment
  I want the studio's idle per-project NLP engines deleted on a schedule
  So that a deployment does not pay for engines nobody has run for a week

  The sweep is the workflow module's own scheduled process manager on its
  `workflow_nlp_lambda_cleanup` pipeline, woken daily by the worker. Main
  reached it over `/api/cron/old_lambdas_cleanup` behind a shared cron bearer;
  there are no cron routes, so that route is retired.

  Rule: The sweep runs on the daily wake

    @unit
    Scenario: The daily wake asks for one sweep
      Given the workflow module's Lambda cleanup process is scheduled
      When the process wakes
      Then it asks for exactly one sweep, keyed by the wake's time

    @unit
    Scenario: A sweep deletes the engines that have been quiet for a week
      Given a deployment whose studio engines can be swept
      And one engine has not run for a month
      When the sweep the wake asked for runs
      Then that engine is deleted

  Rule: A failed sweep waits for the next wake

    @unit
    Scenario: A failed sweep fails its intent and the next wake asks again
      Given a deployment whose studio engines cannot be reached
      When the sweep the wake asked for runs
      Then the sweep fails rather than reporting a clean run
      And the next wake asks for a fresh sweep

  Rule: A deployment with no engine account has nothing to sweep

    @unit
    Scenario: A deployment that composed no Lambda account sweeps nothing on its daily wake
      Given a deployment that composed no NLP Lambda account
      When the sweep the wake asked for runs
      Then it reads nothing and succeeds
