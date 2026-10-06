Feature: Dashboards demo seed - every agent type with a month of traffic
  Dashboard widgets need data to show, and each agent type needs different data:
  outcomes for a support bot, retrieval for a RAG assistant, customers for an agent
  platform, stages for a voice agent, fields for extraction. `pnpm seed:dashboards-demo`
  seeds one organization with one project per agent type, plus an empty project for
  the day-zero state, and sends about 30 days of traffic through the running stack's
  own collector, the way an SDK sends it.

  # Behaviour lives in apps/tasks/src/storage-seed/seed-dashboards-demo.ts and the
  # dashboards-demo-*.ts files beside it. The project shapes come from the prototype
  # langwatch/new-structure at d8eb816. The path through the collector is only
  # exercised by hand against a local stack, so these scenarios stay @unimplemented.

  Background:
    Given a local stack is running
    And a user exists to see the demo

  @unimplemented
  Scenario: One organization, one project per agent type, and an empty project
    When I run "pnpm seed:dashboards-demo"
    Then the organization "Dashboards Demo" has one project for each agent type
      | agent type  |
      | support-bot |
      | rag         |
      | vendor      |
      | voice       |
      | extraction  |
      | regulated   |
      | tools-agent |
      | generative  |
    And it has a project "New project (no data yet)" with no traffic
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
  Scenario: Traffic goes through the collector with each project's own key
    When the seed sends a project's traffic
    Then each trace is posted to "/api/collector" with that project's key
    And each thumbs vote is posted to "/api/track_event" with that project's key
    And no trace is written straight to ClickHouse

  @unimplemented
  Scenario: The traffic carries what the dashboard widgets read
    When the seed has run
    Then the traces carry thread, user and customer ids, labels, models, tokens and cost
    And they carry tool spans, retrieval contexts, errors and latency
    And the support bot's conversations carry a "Conversation Outcome Judge" category label
    And the projects that collect feedback carry "thumbs_up_down" events

  @unimplemented
  Scenario: Re-running the seed duplicates nothing
    Given the seed has run once
    When I run it again
    Then the organization, team, projects and keys are not duplicated
    And every trace, evaluation and event keeps its id, so no row is counted twice

  @unimplemented
  Scenario: A stack that is not running refuses by name
    Given nothing answers at the seed's endpoint
    When I run the seed
    Then it stops after the identity rows
    And the message names the endpoint and DASHBOARDS_DEMO_ENDPOINT
