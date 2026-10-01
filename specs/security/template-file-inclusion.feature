Feature: Customer-authored templates cannot read files
  As a LangWatch operator
  I want customer-authored Liquid templates to have no file system at all
  So that a scenario body template, a prompt or a notification cannot inline a
  file from the process working directory into something the customer receives.

  liquidjs ships with the node file system rooted at the process working
  directory, so `{% render 'x' %}` and `{% include 'x' %}` read a file and place
  its contents in the rendered output. Every engine that renders text a customer
  wrote is therefore built by one shared factory that supplies a file system
  which refuses, rather than by `new Liquid(...)` at each site.

  Rule: A template renders no file, whatever tag it asks with

    @unit
    Scenario: The sandboxed engine refuses a render tag
      Given a Liquid engine from the shared sandboxed factory
      When a template renders a file that exists in the working directory
      Then the render fails and no file content reaches the output

    @unit
    Scenario: The sandboxed engine refuses an include tag
      Given a Liquid engine from the shared sandboxed factory
      When a template includes a file that exists in the working directory
      Then the render fails and no file content reaches the output

    @unit
    Scenario: The sandboxed engine still renders ordinary templates
      Given a Liquid engine from the shared sandboxed factory
      When a template interpolates its context
      Then the output carries the context values

  Rule: Every engine that renders customer-authored text is sandboxed

    @unit
    Scenario: An HTTP agent body template cannot inline a file
      Given an HTTP agent whose body template renders a file path
      When the turn's body is rendered
      Then rendering fails with a template error and the file is not sent

    @unit
    Scenario: A notification template cannot inline a file
      Given an automation notification template that renders a file path
      When the notification is rendered
      Then rendering fails and no file content reaches the notification
