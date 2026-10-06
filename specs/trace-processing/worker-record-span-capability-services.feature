Feature: The record path reads through the peers trace was installed with
  Recording a span reads four things that belong to other features: the project
  a tenant id names, the privacy policy that project resolves to, the cost rules
  its customer stored, and the monitors that run on every message. Each of those
  features is a module the background process installs, so trace reads each one
  through the peer it was installed with rather than through a second reading
  built over the same rows.

  This matters because a second reading is a second answer. A project directory
  built beside the installed one resolves a project's organization on its own;
  a privacy resolution built beside the installed one decides a customer's
  redaction on its own. Both would be correct in isolation and would disagree
  with the interactive process, which is the failure a customer sees as content
  redacted in one place and shown in another.

  Background:
    Given the background process boots every installed module in one graph
    And the record path is composed after that graph has booted

  Rule: The record path's reads go to the installed peers

    @unit
    Scenario: The record path reads through the peers trace was installed with
      Given a trace pipeline built over the privacy and model-provider peers the process installed
      When a span is folded through its record-span command
      Then the span is redacted and its content drop decided by the installed privacy peer
      And its cost rules are listed by the installed model-provider peer

    @unit
    Scenario: The project reads answer through the port the subscribers name
      Given a trace pipeline built over the installed peers
      When the project metadata port is asked for a project, a metadata stamp and the organization admin
      Then it answers the project, writes the stamp and names the admin

    @unit
    Scenario: The cost rules are asked of the model-provider peer by project alone
      Given a trace pipeline built over the installed peers
      When a span's cost rules are listed
      Then the model-provider peer is asked for the span's project and nothing else
      And the record path opens no project reading of its own

  Rule: The peers' answers reach the recorded span

    @unit
    Scenario: A customer's drop is honoured from the privacy peer's answer
      Given a privacy peer whose policy for the project drops the input category
      When a span passes through the record-span command
      Then the privacy peer is asked about that span under the span's project
      And the customer's prompt is gone from the recorded span

    @unit
    Scenario: A project with no stored policy keeps its content
      Given a project with no stored privacy rule
      When a span passes through the content-drop port
      Then nothing is dropped

    @unit
    Scenario: A customer's own rate prices the span
      Given a model-provider peer holding the project's own rate for the model on the span
      When the span passes through the record-span command
      Then the span carries that customer's input and output rates

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
      Then every privacy and cost read names the tenant on the command

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
