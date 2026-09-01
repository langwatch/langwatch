Feature: Langy runs one harness
  As someone whose conversations with Langy are running right now,
  I want the removal of the second coding-agent harness to be invisible to me,
  so that a change with no feature attached to it costs nobody a turn.

  # Cross-references:
  #   ADR-131 — the decision, the two-opencodes distinction, and the four ADRs
  #             whose mechanism this removes.
  #   ADR-130 — per-worker identity isolation; depends on this landing first.
  #   specs/langy/langy-pi-harness.feature — the harness that remains, and the
  #             behaviour these scenarios assume still holds afterwards.
  #
  # ---------------------------------------------------------------------------
  # Why a removal needs a spec at all
  #
  # Nothing here is a new capability. Every scenario is a claim that something
  # a user already relies on is unchanged, or that a hazard specific to THIS
  # removal does not happen. Two hazards make it worth writing down.
  #
  # First, the name. "opencode" is both the harness being removed and a
  # third-party CLI our customers run, which LangWatch instruments, wraps and
  # ingests traces from. The second is a shipping, documented integration and
  # must not be touched. A removal driven by searching for the string deletes
  # it, and the deletion would look correct at every step. The scenarios under
  # "The integration of the same name" exist to fail loudly if that happens.
  #
  # Second, the ordering. Pi is already the only harness anyone is served,
  # because the control plane resolves it per turn from a flag that defaults on
  # and fails safe. But an operator targeting rule can still rule that flag off
  # for one project, and that rule lives in a database rather than in the
  # repository. Removing the code before clearing the rule breaks exactly the
  # customer nobody thought to check.
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # The integration of the same name is untouched
  #
  # These are the scenarios that catch an over-broad removal. They describe
  # surfaces that have nothing to do with the worker harness and must keep
  # working after it is gone.
  # ===========================================================================

  @integration @unimplemented
  Scenario: A customer's own coding-agent CLI is still traced
    Given a customer runs their coding agent under the LangWatch CLI wrapper
    When a session produces spans
    Then those spans arrive and are attributed to that agent
    And nothing about the assistant's own harness affects them
    # The wrapper, its governance plugin and the ingestion path share a name
    # with the harness and none of their code.

  @integration @unimplemented
  Scenario: The gateway's CLI integration still recognises that agent
    Given the AI gateway is configured for a supported coding-agent CLI
    When a request arrives carrying that CLI's identifying attributes
    Then the gateway applies the policy for it as before

  @unit @unimplemented
  Scenario: The documented integration pages still describe a supported product
    Given the published documentation for supported coding agents
    When the assistant's harness is removed
    Then those pages are unchanged
    And no page tells a customer an integration they use has been withdrawn

  # ===========================================================================
  # Harness selection stops being a concept
  # ===========================================================================

  @unit
  Scenario: A turn that names no harness runs
    Given a turn arrives whose credentials name no harness
    When the manager provisions a worker for it
    Then the turn runs
    And nothing about the turn depends on a harness having been chosen

  # The important one. A queued job, a retry, or a control plane that has not
  # yet rolled can carry an envelope naming the harness that no longer exists.
  # That must degrade to a served turn, not a failed one — the alternative is
  # an outage confined to whatever was in flight during the deploy, which is
  # the hardest kind to attribute afterwards.
  @unit
  Scenario: A turn that names the removed harness still runs
    Given a turn arrives naming a harness this manager no longer has
    When the manager provisions a worker for it
    Then the turn runs on the harness that remains
    And the request is not rejected over the name it carried

  @unit @unimplemented
  Scenario: A conversation in flight when the change deploys keeps its thread
    Given a conversation with a running worker and a persisted session
    When the manager is replaced by one with a single harness
    And the next turn arrives for that conversation
    Then the conversation continues from its existing session
    And the user is not told to start again

  # ===========================================================================
  # The operator rule is cleared before the code is
  #
  # The one live configuration this change can break. It is invisible from the
  # repository, so it gets a scenario rather than a comment.
  # ===========================================================================

  @integration @unimplemented
  Scenario: A project ruled onto the old harness is moved before the removal ships
    Given an operator rule directs some project onto the harness being removed
    When the removal is prepared
    Then that rule is found and cleared first
    And the project is served by the remaining harness before any code is removed

  @unit @unimplemented
  Scenario: The rollout control disappears with the thing it controlled
    Given the harness has been removed
    When an operator looks for a way to switch a project back
    Then no such control is offered
    And nothing implies a rollback that would not work
    # A flag with one reachable value invites an operator to try the value that
    # is not there. Leaving it is worse than removing it.

  # ===========================================================================
  # What the removal must not disturb
  # ===========================================================================

  @unit @unimplemented
  Scenario: The app still finds the agent
    Given an install where the app is configured with the agent's address
    When the harness is removed
    Then the app still reaches the agent at that address
    And the setting's name is unchanged
    # The setting carries the old harness's name and has nothing to do with it.
    # Renaming it means moving the chart, the environment example, the local
    # tooling overlay, the chart tests and the docs in one step; done casually
    # alongside this change, the app loses the agent.

  @unit @unimplemented
  Scenario: A worker still reaches everything it legitimately needs
    Given a worker is running a turn
    When it calls the control plane, the gateway, or an allowed external host
    Then the call succeeds as it did before

  @integration @unimplemented
  Scenario: The assistant's own traces still arrive
    Given an operator has pointed the assistant's trace mirror at a project
    When someone holds a conversation
    Then the turn appears as a trace in that project
    And the model calls and tools the turn ran arrive with it

  # ===========================================================================
  # The removal is complete
  #
  # A half-removal leaves a binary nobody runs in an image everybody pulls, and
  # a control surface documented as a security control that no longer exists.
  # ===========================================================================

  @unit @unimplemented
  Scenario: The image carries no runtime for the removed harness
    Given the agent image is built
    Then it contains no binary for the removed harness
    And nothing in the build pins a version of one

  @unit @unimplemented
  Scenario: Local setup does not ask for a binary nothing runs
    Given someone sets up the project for local development
    When the environment is checked
    Then the removed harness's binary is not required
    And its absence is not reported as a problem

  @unit @unimplemented
  Scenario: No published document describes a control that no longer exists
    Given the security documentation for the assistant
    When it explains how one conversation's worker is kept from another's
    Then it describes the mechanism that is actually in place
    And it does not name the per-worker password or the proxy that carried it
    # The replacement is a stronger claim, not a weaker one: the remaining
    # harness has no control port to defend, so a sibling has nothing to reach.
