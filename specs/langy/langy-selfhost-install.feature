Feature: Langy comes up with a self-hosted LangWatch install
  As someone installing LangWatch on my own cluster from the published Helm
  chart,
  I want Langy to work by installing it,
  so that the in-product assistant is part of the product I run, not an
  internal-only feature I can see in the docs but never switch on.

  # Cross-references:
  #   ADR-033 — Langy worker isolation (the sandboxed-runtime posture).
  #   specs/langy/langy-deploy-hardening.feature — the render-time guards.
  #
  # Context. Langy shipped to the hosted product first, so every prerequisite
  # it grew was satisfied out-of-band by our own infrastructure: a secret
  # created by terraform, an image pushed to a private registry, a rollout flag
  # flipped from an internal ops screen, a node pool with a sandboxed runtime.
  # None of that exists for someone installing the chart on their own cluster,
  # and each missing piece failed in a different place: a pod stuck on a secret
  # nobody told them to create, an image that cannot be pulled, an assistant
  # that installs cleanly and then never appears in the product.
  #
  # The through-line of this feature: everything Langy needs to run must be
  # either materialised by the chart or named in one place the operator is
  # actually told about. "Works for us because of something outside the chart"
  # is the bug.

  # ===========================================================================
  # Installing it is enough
  # ===========================================================================

  Scenario: Installing the chart with Langy enabled brings up a working assistant
    Given an operator installs the LangWatch chart on their own cluster
    When they enable the Langy agent
    Then the install completes without asking them to create anything by hand
    And the app and the agent recognise each other on the first request
    And no pod is left waiting on a secret the operator was never told about

  Scenario: An operator who brings their own secrets is told exactly which one Langy needs
    Given an operator supplies their own secrets instead of generated ones
    When they enable the Langy agent
    Then the install names the one value Langy needs from them
    And it fails before deploying rather than half-installing

  Scenario: The agent that installs is the agent the release was tested with
    Given an operator installs a given version of LangWatch
    When the Langy agent starts
    Then it is the agent version that shipped with that release
    And not an older one left behind by a previous release

  # ===========================================================================
  # Installed means usable
  # ===========================================================================

  # The rollout flag exists so the hosted product can open Langy to one cohort
  # at a time. A self-hosted install has exactly one cohort: the people who
  # installed it. Leaving the flag as the hosted default meant an operator
  # deployed the agent, watched it go healthy, and still saw no assistant
  # anywhere in the product, with the only lever an internal screen.
  Scenario: Deploying the agent makes Langy available to the people in that install
    Given an operator has installed LangWatch with the Langy agent enabled
    When someone on that install opens the product
    Then Langy is available to them
    And nobody has to flip anything in an internal-only screen first

  Scenario: An operator who wants a staged rollout keeps one
    Given an operator wants to try Langy with a few people before everyone
    When they install the agent with the everyone-at-once switch turned off
    Then Langy stays dark until they open it to the people they choose
    And the choice of who gets it stays theirs to make

  # ===========================================================================
  # The sandbox posture, on clusters that cannot offer one
  # ===========================================================================

  # Langy runs LLM-written shell, so the sandboxed runtime is the posture we
  # want everywhere. But requiring it silently made "no sandboxed runtime" mean
  # "no Langy at all", which is most self-managed clusters. The rule we keep is
  # that nobody runs it unsandboxed by ACCIDENT: the risk has to be accepted out
  # loud, in the values file, before the chart will render it.
  Scenario: An operator whose cluster has no sandboxed runtime can still run Langy, deliberately
    Given a cluster with no sandboxed runtime available
    When the operator accepts the reduced isolation explicitly
    Then Langy installs and runs
    And the acceptance is recorded in their own values, not buried in a default

  Scenario: Leaving the sandbox out without saying so is still refused
    Given a cluster with no sandboxed runtime available
    When the operator has not accepted the reduced isolation
    Then the install still refuses to render
    And the refusal explains both what is missing and how to accept it

  # ===========================================================================
  # Watching Langy work, in the install that runs it
  # ===========================================================================

  # LangWatch is an observability product, so the assistant it ships should be
  # observable with the same tools — in the operator's own install, not only in
  # ours. This is the dogfooding loop the product is for.
  Scenario: Langy's own work shows up as traces in the operator's LangWatch
    Given an operator has pointed Langy's trace mirror at one of their projects
    When someone holds a conversation with Langy
    Then that turn appears as a trace in that project
    And the trace shows the model calls and the tools the turn ran

  # ===========================================================================
  # Off stays off
  # ===========================================================================

  Scenario: An install that does not want Langy is unaffected by it
    Given an operator installs LangWatch without the Langy agent
    When the install completes
    Then nothing in the install references the assistant
    And the rest of the product behaves exactly as it did before Langy existed
