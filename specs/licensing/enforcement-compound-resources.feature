Feature: License enforcement when one click creates two billable resources
  As an operator on a plan with resource limits
  I want a create action that produces two resources to be blocked by whichever limit is exhausted
  So that I am told which limit stopped me instead of half-creating something or seeing a raw failure

  # Sibling scope: specs/licensing/enforcement-resources.feature covers
  # single-resource enforcement per resource type (backend guards and the
  # click-then-modal UI). This file is only about the COMPOUND case, where
  # one click creates two limited resources and one limit check is not
  # enough.
  #
  # "Create a workflow agent" and "create a workflow evaluator" each create
  # a workflow AND a second resource. `checkCompoundLimits`
  # (platform/app/src/hooks/useCompoundLicenseCheck.ts) chains the per-resource
  # `useLicenseEnforcement` checks in array order and runs the create
  # callback only once every check has passed. Both drawers pass
  # `[workflowEnforcement, <resource>Enforcement]`, so the workflow limit is
  # always the first one consulted.
  #
  # All copy quoted below is what the UI actually renders:
  #   - the upgrade modal body, from
  #     platform/app/src/components/upgrade-modal/LimitContent.tsx
  #   - each toast title, from the `fallbackTitle` the create site hands to
  #     `showErrorToast`.
  # Resource names in the modal come from LIMIT_TYPE_LABELS and are
  # lowercase ("workflows", "agents", "evaluators").

  Background:
    Given an organization with a valid license

  # ==========================================================================
  # Chaining: every limit is consulted, in order, before anything is created
  # ==========================================================================

  @unit
  Scenario: A compound create blocked by the workflow limit reports workflows
    Given the workflows limit is exhausted at 3 of 3
    And the agents limit still has room at 2 of 5
    When a compound create checks workflows and then agents
    Then the upgrade modal is opened for workflows showing 3 of 3
    And the agents limit is never reported
    And nothing is created

  @unit
  Scenario: A compound create blocked by the second limit in the chain reports that resource
    Given the workflows limit still has room at 2 of 5
    And the agents limit is exhausted at 3 of 3
    When a compound create checks workflows and then agents
    Then the upgrade modal is opened for agents showing 3 of 3
    And nothing is created

  @unit
  Scenario: A compound create runs exactly once when every limit in the chain allows it
    Given the workflows limit still has room at 2 of 5
    And the agents limit still has room at 2 of 5
    When a compound create checks workflows and then agents
    Then no upgrade modal is opened
    And the create action runs exactly once

  @unit
  Scenario: A compound create with no limits to check proceeds immediately
    Given a compound create with an empty chain of limits
    When the compound check runs
    Then no upgrade modal is opened
    And the create action runs exactly once
    # The recursion's base case. If this branch stopped calling through, a
    # create site that passed no enforcements would silently do nothing.

  # ==========================================================================
  # Where the chain is wired: the two compound create surfaces
  # ==========================================================================

  @integration @unimplemented
  Scenario: Creating a workflow agent at the workflow limit names workflows in the modal
    Given the organization has 3 of 3 workflows and 2 of 5 agents
    When I click "Create & Open Editor" in the workflow agent drawer
    Then the upgrade modal reads "You've reached the limit of 3 workflows on your current plan."
    And it reads "Current usage: 3 / 3"
    And no error toast is shown

  @integration @unimplemented
  Scenario: Creating a workflow agent at the agent limit names agents in the modal
    Given the organization has 2 of 5 workflows and 3 of 3 agents
    When I click "Create & Open Editor" in the workflow agent drawer
    Then the upgrade modal reads "You've reached the limit of 3 agents on your current plan."
    And it reads "Current usage: 3 / 3"
    And no error toast is shown

  @integration @unimplemented
  Scenario: Creating a workflow evaluator at the workflow limit names workflows in the modal
    Given the organization has 3 of 3 workflows and 2 of 5 evaluators
    When I click "Create & Open Editor" in the workflow evaluator drawer
    Then the upgrade modal reads "You've reached the limit of 3 workflows on your current plan."
    And it reads "Current usage: 3 / 3"
    And no error toast is shown

  @integration @unimplemented
  Scenario: Creating a workflow evaluator at the evaluator limit names evaluators in the modal
    Given the organization has 2 of 5 workflows and 3 of 3 evaluators
    When I click "Create & Open Editor" in the workflow evaluator drawer
    Then the upgrade modal reads "You've reached the limit of 3 evaluators on your current plan."
    And it reads "Current usage: 3 / 3"
    And no error toast is shown

  @integration @unimplemented
  Scenario: A compound create under both limits opens the editor
    Given the organization is under both its workflow and agent limits
    When I click "Create & Open Editor" in the workflow agent drawer
    Then the workflow and the agent are created
    And no upgrade modal is shown

  # ==========================================================================
  # Toast suppression: the modal is the report, so the toast must not double up
  # ==========================================================================
  #
  # The server rejects the create with a limit error, the global mutation
  # cache marks that error handled and opens the modal, and the create
  # site's `showErrorToast` returns early for an already-handled error.
  # Each site's own fallback title is what would otherwise appear.

  @integration @unimplemented
  Scenario: Hitting the workflow limit at submit time shows the modal without a toast
    Given the organization reached its workflow limit after the form was opened
    When I submit the new workflow form
    And the server rejects the create for the workflows limit
    Then the upgrade modal is displayed
    And no "Couldn't create workflow" toast is shown

  @integration @unimplemented
  Scenario: Hitting the workflow limit while creating a workflow agent shows the modal without a toast
    Given the organization reached its workflow limit after the form was opened
    When I submit the workflow agent creation form
    And the server rejects the create for the workflows limit
    Then the upgrade modal is displayed
    And no "Couldn't create workflow agent" toast is shown

  @integration @unimplemented
  Scenario: Hitting the workflow limit while creating a workflow evaluator shows the modal without a toast
    Given the organization reached its workflow limit after the form was opened
    When I submit the workflow evaluator creation form
    And the server rejects the create for the workflows limit
    Then the upgrade modal is displayed
    And no "Couldn't create workflow evaluator" toast is shown

  @integration @unimplemented
  Scenario: A create failure that is not a limit error still reaches the user as a toast
    Given the server rejects the create for a reason unrelated to licensing
    When I submit the new workflow form
    Then the failure is surfaced to the user
    And no upgrade modal is displayed
    # Suppression is keyed on the error having been handled by the license
    # interceptor. An unrelated failure must not inherit that silence.
