Feature: The studio's quiet NLP Lambda functions are swept on a schedule
  As the operator of a LangWatch deployment
  I want the studio's idle per-project NLP engines deleted on a schedule
  So that a deployment does not pay for engines nobody has run for a week

  The sweep is the workflow module's own operation, reached over
  `/api/cron/old_lambdas_cleanup` behind the deployment's shared cron bearer.
  The scheduler reads the answer to decide whether to alert, so both the
  success sentence and the failure sentence are a published promise.

  Rule: The sweep answers the scheduler in its own words

    @unit
    Scenario: A completed sweep answers the sentence the scheduler expects
      Given a deployment whose studio engines can be swept
      When the scheduler calls the old-lambdas-cleanup route
      Then the response reports the sweep succeeded

    @unit
    Scenario: The same sweep answers a scheduler that issues it as a GET
      Given a deployment whose studio engines can be swept
      When the scheduler reads the old-lambdas-cleanup route instead of posting to it
      Then the sweep runs once and reports the same success

    @unit
    Scenario: A failed sweep answers the failure rather than a generic envelope
      Given a deployment whose studio engines cannot be reached
      When the scheduler calls the old-lambdas-cleanup route
      Then the response carries the failure the scheduler alerts on

  Rule: A deployment with no engine account refuses rather than reporting a clean run

    @unit
    Scenario: A deployment that composed no Lambda account refuses the sweep by name
      Given a deployment that composed no NLP Lambda account
      When the scheduler calls the old-lambdas-cleanup route
      Then the sweep refuses and names the missing account rather than reporting nothing to delete
