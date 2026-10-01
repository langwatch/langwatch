Feature: The worker mounts the trace processing pipeline
  Every span LangWatch ingests is folded by the trace processing pipeline, and
  the frozen job registry lists twenty-nine routing keys for it. A worker
  process that registers fewer does not degrade: the queue keeps redelivering
  the jobs nothing claimed, forever.

  Until now the standalone worker could BUILD that pipeline but not mount it —
  the record-span command and fifteen subscriber handlers were parameters a
  caller had to supply, and there was no caller. This feature is about the
  parameters becoming composition: the worker builds its own record-span
  command, its own alert-trigger subscriber, its own tracked-event span
  builder, its own dataset normalization, and hands the pipeline to the queue.

  What a customer notices is only ever the absence: a rating that never
  recorded, an alert that never fired, a project stuck on the onboarding card
  after its first real trace.

  Background:
    Given a worker process holding one database, one queue and one object store
    And the trace pipeline composed from packages alone

  Rule: Every routing key the registry lists is claimed

    @unit
    Scenario: The worker mounts every trace routing key
      Given the byte-frozen job registry's twenty-nine trace processing keys
      When the worker builds and mounts its trace pipeline
      Then every key is claimed but the two the feature installer owns
      And no key is registered that the registry does not list
      And the record-span command carries a real handler rather than a stand-in

  Rule: Alerts fire from the worker, and only on real ingestion

    @unit
    Scenario: A trace alert is matched and recorded from the worker
      Given a project with one active trace automation
      When an ingested trace reaches the alert subscriber
      Then one durable match is recorded through the automations feature's own recorder
      And it names the trigger, its action and the class of that action

    @unit
    Scenario: A replayed trace does not re-fire an alert
      Given a trace whose fold carries no ingestion origin
      When it reaches the alert subscriber
      Then nothing is recorded

  Rule: What a span reports reaches the feature that owns it

    @unit
    Scenario: An SDK-reported evaluation reaches Evaluation's own command
      Given a span carrying a custom evaluation the customer's SDK ran
      When the evaluation sync subscriber runs
      Then the evaluation is reported through the evaluation feature's command
      And its evaluator id comes from that feature's own slug rule

    @unit
    Scenario: Live span feedback is recorded as a tracked event
      Given a span carrying a thumbs-up the customer left
      When the tracked event subscriber runs
      Then a span is minted for the rating and recorded through the trace pipeline
      And it carries the event type, the event id and the rating as attributes

    @unit
    Scenario: A project's first trace claims its topic clustering
      Given a project that has not yet received a real trace
      When its first trace reaches the project metadata subscriber
      Then the project's topic clustering is claimed through the topics feature
      And the integration milestone is reported against the organization admin

    @unit
    Scenario: Scenario and Experiment metrics are published from the worker
      Given a settled simulation trace and a settled experiment trace
      When each reaches its metrics subscriber
      Then the simulation metrics are published through the scenario feature's command
      And the experiment metrics are published through the experiment feature's command
      And the experiment run is resolved through the lookup this process composed

    @unit
    Scenario: Both broadcast subscribers publish through one bridge
      Given a trace update and a span storage event
      When each reaches its broadcast subscriber
      Then both publish through the one tenant bridge this process composed
