Feature: Dashboards demo seed - realistic synthetic data for every dashboard widget
  Dashboard widgets need data to show, and each agent type needs different data:
  outcomes for a support bot, retrieval for a RAG answerer, sub-agents for a planner,
  sessions for a coding agent, fields for a batch classifier. `pnpm seed:dashboards-demo`
  seeds one organization with three projects that each run several named agents, plus an
  empty project for the day-zero state, and sends 60 days of history through the running
  stack's own doors, the way an instrumented app, the scenario SDK and the gateway send it.
  Traces, Langy's turns among them, reach back 30 days: the trace door takes nothing older.

  # Behaviour lives in apps/tasks/src/storage-seed/seed-dashboards-demo.ts and the
  # dashboards-demo-*.ts files beside it. The agent shapes come from the prototype
  # langwatch/new-structure at d8eb816. The paths through the stack are only exercised
  # by hand against a local stack, so these scenarios stay @unimplemented.

  Background:
    Given a local stack is running
    And a user exists to see the demo

  @unimplemented
  Scenario: Three projects run named agents, and one project is empty
    When I run "pnpm seed:dashboards-demo"
    Then the organization "Dashboards Demo" has these projects and agents
      | project         | agents                                                       |
      | Customer care   | shop-assistant, help-center-answerer, delivery-caller        |
      | Agent platform  | checkout-planner, invoice-classifier, catalogue-copywriter   |
      | Engineering     | code-helper, ops-cowork                                      |
    And every agent trace names its agent in gen_ai.agent.name
    And it has a project "New project (no data yet)" with no traffic
    And a project the demo team holds that the seed no longer lists is archived
    And the user is an admin of the organization and its team
    And no other user is created

  @unimplemented
  Scenario: The demo user is chosen by email, or is the local-dev admin
    When I run the seed with DASHBOARDS_DEMO_USER_EMAIL set to an existing user's email
    Then that user is added to the demo organization
    When I run the seed without it
    Then the local-dev admin is added instead

  @unimplemented
  Scenario: A missing demo user refuses by name
    When I run the seed with DASHBOARDS_DEMO_USER_EMAIL set to an email no user has
    Then the seed stops before writing anything
    And the message names the email

  @unimplemented
  Scenario: The size flag sets the volume
    When I run the seed with DASHBOARDS_DEMO_SIZE set to "small", "medium" or "large"
    Then each agent sends about 0.3, 1 or 6 times its usual daily volume
    And DASHBOARDS_DEMO_DAYS sets how many days of history, 60 by default
    And any other size refuses by name

  @unimplemented
  Scenario: Traffic goes through the stack's own doors with each project's key
    When the seed sends a project's traffic
    Then spans are posted to "/api/otel/v1/traces" and their evaluations to "/api/collector"
    And thumbs votes are posted to "/api/track_event"
    And scenario runs are posted to "/api/scenario-events"
    And experiment runs are posted to "/api/evaluations/batch/log_results"
    And prompt versions are made through "/api/prompts"
    And reviewer thumbs are made through "/api/annotations/trace/:id"
    And coding-agent sessions are posted to "/api/otel/v1/logs" and "/api/otel/v1/traces"
    And each agent's model calls are drained as gateway spend under its own virtual key
    And no trace is written straight to ClickHouse

  @unimplemented
  Scenario: Each door gets as much history as the stack keeps for it
    Given the trace doors drop a span that started more than 31 days ago
    When the seed runs with 60 days of history
    Then traces, their evaluations and thumbs are sent for the last 30 days only
    And Langy's turns are traces, so Langy history is 30 days long, and the log says so
    And gateway spend and prompt versions cover all 60 days
    And scenario runs and coding-agent sessions cover the last 48 days, see the retention scenario

  @unimplemented
  Scenario: Langy history lands in the Langy mirror project
    Given LANGY_MIRROR_PROJECT_ID and LANGY_MIRROR_TRACE_KEY name a project
    When the seed has run
    Then that project holds Langy turns with origin "langy", the same shape the mirror sends
    And each turn carries its user, model calls with tokens and cost, and CLI tool calls
    And some turns fail, and reviewers thumb some turns

  @unimplemented
  Scenario: Langy's own turns sit beside a normal project's traces
    When the seed has run
    Then about 5% of the traces in "Customer care" are Langy turns with origin "langy"
    And they have the shape the gateway gives the asking project, which names no source organization
    # This is the mirror shape, not the full one: a live turn in an asking project also carries
    # a "langy.turn" root span and the worker's spans, which the seed does not send.
    And no other demo project holds a Langy turn

  @unimplemented
  Scenario: The seed writes to the database only where no door exists
    When the seed has run
    Then prompt versions and reviewer thumbs carry the dates of their story, set in the database
    And the review queue and its items are written to the database
    And the log says which of these it wrote

  @unimplemented
  Scenario: The traffic carries what the dashboard widgets read
    When the seed has run
    Then the traces carry thread, user and customer ids, labels, models, tokens and cost
    And they carry tool spans, sub-agent spans, retrieval contexts, errors, retries and latency
    And traffic follows the working day and the week, with long-tailed latency and tokens
    And the support bot's conversations carry a "Conversation Outcome Judge" category label
    And the projects that collect feedback carry "thumbs_up_down" events

  @unimplemented
  Scenario: The history tells a story widgets can find
    When the seed has run
    Then the shop assistant's move to gpt-5-nano 14 days ago lowers its answer quality
    And the checkout planner's loops raise its cost for four days
    And Customer care has an outage hour 5 days ago at 14:00 UTC
    And the scenario "Return a damaged parcel" passes about half the time
    And the customer "harbor-pine" resolves fewer conversations from 11 days ago

  @unimplemented
  Scenario: Re-running the seed sends only what a project does not hold yet
    Given the seed has run once
    When I run it again, an hour or a week later
    Then the organization, team, projects and keys are not duplicated
    And a trace the project already holds is not sent again, nor are its evaluations and thumbs
    And a coding session or an experiment run the project already holds is not sent again
    And a finished scenario run or a settled gateway request the project holds is not sent again
    And only traffic that happened since the last run is added

  @unimplemented
  Scenario: What a project holds is asked of the stack's own read APIs
    When the seed runs
    Then it lists a project's traces through "/api/traces/search", Langy's turns included
    And it lists sessions, experiment runs, scenario runs and spend through "/api/v1/query"
    And it stops with the stack's answer when a list cannot be read, and sends nothing blind

  @unimplemented
  Scenario: History older than the stack's data retention is not sent
    Given the stack drops scenario runs and coding sessions older than a project's retention
    And that retention is 49 days unless the project sets its own
    When the seed runs with 60 days of history
    Then it sends scenario runs and coding sessions for the last 48 days only
    And so no run sends again what the stack would drop

  @unimplemented
  Scenario: A door that drops data inside a 200 is a refusal
    When a door answers 200 but reports rejected spans, evaluations or log records
    Then the seed counts that body as refused and logs what the door said
    And it stops once more than 25 bodies are refused

  @unimplemented
  Scenario: A stack that is not running refuses by name
    Given nothing answers at the seed's endpoint
    When I run the seed
    Then it stops after the identity rows
    And the message names the endpoint and DASHBOARDS_DEMO_ENDPOINT
