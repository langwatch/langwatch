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

  Scenario: A plain install brings up a working assistant
    Given an operator installs the LangWatch chart on a cluster with a sandboxed runtime
    When the install completes with default values
    Then the Langy agent is running without any Langy-specific values set
    And nothing was created by hand
    And the app and the agent recognise each other on the first request
    And no pod is left waiting on a secret the operator was never told about

  Scenario: An operator who brings their own secrets is told exactly which one Langy needs
    Given an operator supplies their own secrets instead of generated ones
    When they install with the Langy agent kept on
    Then the install names the one value Langy needs from them
    And it fails before deploying rather than half-installing

  Scenario: The agent that installs is the agent the release was tested with
    Given an operator installs a given version of LangWatch
    When the Langy agent starts
    Then it is the agent version that shipped with that release
    And not an older one left behind by a previous release

  # The pieces of an install have to address each other by names that mean the
  # same thing from inside the cluster. Both failures below were invisible from
  # the outside: every pod healthy, and either no answer at all or an answer
  # that cost real tokens and was then thrown away.
  Scenario: Langy can reach the model provider the install already configured
    Given an operator has installed LangWatch with the Langy agent enabled
    And a model provider is configured for the project
    When someone asks Langy a question
    Then Langy reaches the model
    And it does not refuse the turn over a setting the operator was never asked for

  Scenario: An answer Langy produces makes it back to the person who asked
    Given someone has asked Langy a question
    When Langy finishes working
    Then the answer arrives in the conversation
    And the tools it ran along the way arrive with it
    # The reply, the tool results, and the turn's traces all travel the same way
    # back to the control plane. Pointing that route at an address that only
    # means something outside the cluster loses all three at once, after the
    # model has already been paid for.

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

  # Langy runs LLM-written shell, so what bounds it must be on by default. The
  # controls that bound the attack that actually happens are on in a default
  # install: per-worker identity isolation, the per-worker session boundary,
  # and a NetworkPolicy with egress off.
  #
  # This spec used to claim those cost nothing "and identically on every
  # cluster". That was wrong, and a customer found the exception. Per-worker
  # identity isolation costs the container root plus five capabilities, so on a
  # cluster enforcing Pod Security Admission "restricted" — or any policy engine
  # requiring runAsNonRoot — it costs the whole install: the pod is refused at
  # admission. On those clusters the honest choice is between sibling isolation
  # and having an assistant at all, and ADR-130 makes it the operator's to make
  # rather than the chart's. Everywhere else the default stands unchanged.
  #
  # A sandboxed runtime is the rung above, guarding the node kernel against a
  # worker that escapes its container. It is NOT the default, because it is the
  # one control whose behaviour depends on the operator's node image, container
  # runtime and sandbox build. A default nobody can test on their nodes fails in
  # ways that read as "Langy is broken", so it is a step an operator takes on
  # purpose, and the install tells them how.
  Scenario: A default install runs the assistant on a cluster with no sandboxed runtime
    Given a cluster with no sandboxed runtime available
    When the operator installs with default values
    Then Langy installs and runs
    And the isolation the install does have is stated back to the operator
    And they are told where to read about hardening it further

  # The counterexample to the old "any cluster" promise. Worth stating as its
  # own scenario because the failure it replaces was not a refusal an operator
  # could act on: the pod was admitted, reported healthy, and died at the first
  # chown, which reads as a product bug rather than a policy outcome.
  Scenario: An install on a cluster that refuses root is told what the choice is
    Given a cluster whose policy requires every pod to run as a non-root user
    When the operator installs with default values
    Then the agent does not run
    And the operator can tell that their policy is what stopped it
    And they are told which value trades sibling isolation for an install
    And the rest of the product installs and runs regardless

  Scenario: An operator hardens the agent onto a sandboxed runtime
    Given a cluster with a sandboxed runtime available
    When the operator pins the agent to it
    Then Langy installs and runs under that sandboxed runtime

  Scenario: A cluster that has hardened cannot silently lose its sandbox
    Given an operator has pinned the agent to a sandboxed runtime
    When the sandbox is later blanked without accepting the reduced isolation
    Then the install refuses to render
    And the refusal explains both what is missing and how to accept it

  # Nobody has to go looking for the upgrade if their cluster already offers it.
  Scenario: An install on a cluster that already offers a sandbox is told so
    Given a cluster that defines a sandboxed runtime class
    And the operator has not pinned the agent to it
    When the install completes
    Then the notes name the class their cluster offers
    And they still get a working assistant in the meantime

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
    Given an operator installs LangWatch with the Langy agent disabled
    When the install completes
    Then nothing in the install references the assistant
    And the rest of the product behaves exactly as it did before Langy existed
