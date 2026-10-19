Feature: A module's collaborators are installed modules, never optional options
  As an operator running a LangWatch API deployment
  I want a module that collaborates with another module to refuse to boot without it
  So that no surface is left refusing on every request because nobody hosted its collaborator

  # The production composition used to take one flat options object whose fields
  # were all optional: a field with no fallback left the surface behind it
  # refusing by name on every deployment. There is no such object now. Each
  # collaborator (read-time redactions, the reviewer's trace content, simulation
  # evidence, person-shaped messages, seat allowances) is another module's *Api,
  # declared by the module that needs it and answered by the installed module.

  Rule: a collaborator is a peer module, present or the boot refuses

    @unit
    Scenario: A module whose collaborating module is not installed refuses to boot
      Given a module that declares another module's Api as a collaborator
      When a process installs it without the collaborating module
      Then the boot refuses, naming the module and the collaborator
      And no surface is mounted that would refuse every request

    @unit
    Scenario: A module whose collaborating module is installed boots and is answered by it
      Given a module that declares another module's Api as a collaborator
      When a process installs both modules
      Then the boot succeeds
      And the module reaches its collaborator through the installed module
