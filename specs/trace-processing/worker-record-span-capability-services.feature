Feature: The record path's capability services compose outside the application
  Recording a span reads four things that belong to other features: the project
  a tenant id names, the privacy policy that project resolves to, the cost rules
  its customer stored, and the monitors that run on every message. Today each of
  those arrives as a whole capability service, and each of those services is
  built for its WRITE half — creating a project mints an ingestion key and needs
  an organization, writing a privacy rule has to decide which organization a
  team belongs to, authoring a cost authorizes a scope, creating a monitor
  resolves an evaluator. A process that only folds spans had to be able to build
  all of that or none of it, so a standalone worker could not build
  `command:recordSpan` at all.

  This feature is about each of those four features publishing the read half on
  its own, so a background process composes them from one Prisma client and its
  own configuration. Nothing is mounted: the application still owns every
  registration, still builds the wide services and still records every span.
  What has to be true today is that the composition CAN be built, and that the
  wide service and the read half answer identically — because they are one
  implementation, not two copies.

  Background:
    Given the application still owns the record-span command
    And the worker composition root holds only what a standalone process has

  Rule: The four capability services compose from a database alone

    @unit
    Scenario: The record path's capability services compose from a database alone
      Given a background process holding one Prisma client
      When it composes the capability services the record path reads through
      Then all four are built
      And no organization, authorization, evaluator or credentials collaborator is asked for

    @unit
    Scenario: The project reads answer through the port the subscribers name
      Given the composed capability services
      When the project metadata port is asked for a project, a metadata stamp and the organization admin
      Then it answers the project, writes the stamp and names the admin

    @unit
    Scenario: A failing organization-admin read does not fail the fold that asked
      Given a project read that fails
      When the organization admin is resolved
      Then an empty resolution is answered and the failure is reported to diagnostics

  Rule: The composed services answer real questions, not empty ones

    @unit
    Scenario: A customer's drop is honoured from the policy rows alone
      Given a project whose stored policy drops the input category
      When a span passes through the content-drop port built on the composed services
      Then the customer's prompt is gone and the drop names the input category

    @unit
    Scenario: A project with no stored policy keeps its content
      Given a project with no stored privacy rule
      When a span passes through the content-drop port
      Then nothing is dropped

    @unit
    Scenario: A customer's own rate prices the span
      Given a project with its own rate for the model on the span
      When the span passes through the cost-enrichment port built on the composed services
      Then the span carries that customer's input and output rates
      And the rules were read under the project, team and organization scopes

    @unit
    Scenario: A project that cannot be read prices nothing rather than failing
      Given a project that no longer resolves
      When its costs are listed
      Then the list is empty and no cost row is read

    @unit
    Scenario: The evaluation trigger reads a project's on-message monitors
      Given a project with one monitor enabled to run on every message
      When the monitor port is asked for the listing
      Then only that project's enabled on-message monitors are answered

  Rule: The record-span command itself composes

    @unit
    Scenario: The record command composes from a database and a configuration
      Given a background process holding one Prisma client and its resolved configuration
      When it composes the record-span command
      Then the command is built without a capability service being handed in

    @unit
    Scenario: A folded span carries the customer's rates and keeps its content
      Given a composed record-span command and a project with its own rates
      When a span is folded through it
      Then the recorded span carries the customer's rates
      And the content the customer did not ask to be dropped is still there

    @unit
    Scenario: A folded span honours a stored drop policy
      Given a composed record-span command and a project that drops its input
      When a span is folded through it
      Then the recorded span no longer carries the dropped content

    @unit
    Scenario: The fold reads the tenant's own project and nothing wider
      Given a composed record-span command
      When a span is folded through it
      Then every project read names the tenant on the command
      And the cost rules are read under that project's own three scopes

  Rule: The kill switches stay readable

    @unit
    Scenario: The flag service composes without a shared cache
      Given a deployment that configured no Redis
      When the flag service is composed
      Then it is built rather than refused

    @unit
    Scenario: An environment force-enable is honoured without a stored row
      Given a deployment that force-enabled a flag in its environment
      When the flag is read
      Then it answers enabled without reading a stored row

    @unit
    Scenario: The worker reads the same flag overrides the application reads
      Given a deployment that named a flag on its force-enable list
      When the worker configuration is resolved
      Then that flag is carried on the resolved configuration

  Rule: The graph-alert vertical takes the project reads this process composes

    @unit
    Scenario: The graph vertical takes the project reads this process composes
      Given the composed project metadata service
      When the graph-alert vertical is composed over it
      Then the vertical is built, and only the analytics reads are still handed in
