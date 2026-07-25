Feature: The assistant works on a laptop install
  As someone who ran `npx @langwatch/server`
  I want Langy to answer questions and run its tools
  So that the assistant is part of the product I installed, not a feature I
    can only get by running Kubernetes

  See _shared/contract.md for paths, ports, secrets, supervision rules.
  See specs/langy/langy-selfhost-install.feature for the cluster story, the
  same feature, a very different set of prerequisites.

  # Context. Langy was built for a cluster: a pod per install, a sandboxed
  # container runtime under it, and a manager running as root so each
  # conversation's worker gets its own UID. A laptop has none of that, and
  # cannot be asked to get it. What a laptop does have is the thing the cluster
  # went to such lengths to simulate: a single trusted user.
  #
  # So the isolation that matters here is different, and saying so plainly is
  # part of the feature. On one machine, one person, every worker already runs
  # as that person with that person's own credentials. There is no second
  # tenant to protect them from, and nothing gained by pretending otherwise.

  Background:
    Given someone has installed LangWatch with `npx @langwatch/server`

  # ===========================================================================
  # It works
  # ===========================================================================

  Scenario: The assistant answers on a fresh laptop install
    Given they have configured a model provider
    When they open the assistant and ask it something
    Then it answers
    And nothing had to be installed by hand first

  Scenario: The assistant answers from the install's own data
    When they ask the assistant something that needs LangWatch's own data
    Then the answer reflects what this install actually contains
    And not just what a language model would guess

  Scenario: The assistant is available without being switched on somewhere else
    When they open the product after installing
    Then the assistant is there
    # Its rollout flag exists so the hosted product can open it one cohort at a
    # time. A laptop is one cohort of one.

  # ===========================================================================
  # No sandbox to be had, and that is the honest default
  # ===========================================================================

  Scenario: A laptop install does not demand a sandboxed runtime
    When the assistant starts
    Then it starts without a container sandbox
    And the install does not fail asking for one
    # The cluster chart refuses to deploy unsandboxed unless the operator
    # accepts it, because there the workers belong to different people. Here
    # they are all the same person, already on their own machine.

  Scenario: Workers run as the person who started the server
    When the assistant spawns a worker for a conversation
    Then that worker runs as the user who ran the installer
    And it is not asked for the privileges it would need to do otherwise
    # Handing each worker its own UID needs root. Asking someone to run their
    # laptop install as root to isolate them from themselves is a worse trade
    # than not isolating.

  # ===========================================================================
  # What it costs, and opting out of that cost
  # ===========================================================================

  Scenario: The assistant brings its own runtime, once
    When the install runs
    Then whatever the assistant needs to run is fetched as part of it
    And re-running the installer does not fetch it again

  Scenario: Someone who does not want the assistant does not pay for it
    Given they have turned the assistant off
    When the install runs
    Then the assistant's runtime is not downloaded
    And nothing else about the install changes
