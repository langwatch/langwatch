Feature: The record path's capability services come from the one installed graph
  Recording a span reads four things that belong to other features: the project
  a tenant id names, the privacy policy that project resolves to, the cost rules
  its customer stored, and the monitors that run on every message. Each of those
  features is a module the background process now installs, so each arrives as
  the application the process booted rather than as a second reading built over
  the same rows.

  This matters because a second reading is a second answer. A project directory
  built beside the installed one resolves a project's organization on its own;
  a privacy resolution built beside the installed one decides a customer's
  redaction on its own. Both would be correct in isolation and would disagree
  with the interactive process, which is the failure a customer sees as content
  redacted in one place and shown in another.

  Background:
    Given the background process boots every installed module in one graph
    And the record path is composed after that graph has booted

  Rule: The four capability services are taken from the installed applications

    @unit
    Scenario: The record path's capability services are taken from the one graph
      Given a background process holding the project, privacy and monitor applications it installed
      When it composes the capability services the record path reads through
      Then all four are built
      And the project directory it reads through is the one the process installed

    @unit
    Scenario: The project reads answer through the port the subscribers name
      Given the composed capability services
      When the project metadata port is asked for a project, a metadata stamp and the organization admin
      Then it answers the project, writes the stamp and names the admin

    @unit
    Scenario: The cost catalogue resolves scopes through that same project directory
      Given the composed capability services
      When a span's cost rules are listed
      Then the project, team and organization scopes come from the installed directory
      And no second project reading is opened

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
    Scenario: The flag application is the one the process installed
      Given a background process that booted its module graph
      When the kill switch the event bus reads is resolved
      Then it answers from the installed flag application rather than a second one

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
