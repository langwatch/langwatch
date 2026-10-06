Feature: The agent module installs with the modules it needs
  As an operator running a LangWatch API deployment
  I want a process that installs the agent module without a module it needs to refuse to boot
  So that an agents door never answers over a peer nobody installed

  # The agent module declares the workflow and audit-log modules it needs
  # (its static dependencies). A process installing it without either refuses
  # to boot, naming the module and the peer (record sections 3 and 6). There is
  # no host that injects an agent service, and no process composes one by hand.

  Rule: A process missing a module the agent module needs refuses to boot

    @unit
    Scenario: A process installing agent without the modules it needs refuses to boot
      Given the agent module declares the workflow and audit-log modules as peers
      When a process installs it with neither installed
      Then the boot refuses, naming the agent module and the first peer missing
      And the agent module's service is never constructed
      And the process never becomes ready

  Rule: Copying a workflow agent copies its graph through the workflow module

    @unit
    Scenario: A copied workflow agent points at the graph the workflow module copied
      Given an agent service composed with the workflow module as its peer
      And a workflow agent pointing at a Studio graph
      When the agent is copied to another project
      Then the workflow module is asked to copy the graph into that project
      And the copied agent points at the graph the workflow module returned
      And the source agent is unchanged

    # The boot statement used to carry a standing list of adapters no package
    # implemented, and the entries that closed had to be removed from it by
    # hand. The list outlived its last true entry and was deleted.
