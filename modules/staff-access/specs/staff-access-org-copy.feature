Feature: Copying an organization's setup into another organization
  Staff stand up a demo organization from a source organization without database access or
  scripts. The copy runs on the server through each owner's API, copies an allowlist of kinds
  only, and needs one approval per organization, both live at once. Module ADR-002, ADR-193.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia's agent holds a requester key

  @unit
  Scenario: ops:copy comes with org:content or org:support
    Given a request body with the scope "ops:copy" and no organization scope
    Then the request is refused as invalid
    And "ops:copy" with "org:content" on ACME is a valid request

  @unit
  Scenario: The copy allowlist names only setup kinds
    Then the kinds an organization copy reads are projects, evaluators, monitors, prompts and datasets
    And no kind is a secret, API key, model provider, member, role, SSO, billing, licence or usage counter

  @integration
  Scenario: An ops:copy approval needs the organization name typed
    Given a pending request for "ops:copy" and "org:support" on Globex
    When Olivia approves it without typing the organization's name
    Then the approval is refused with "organization_name_mismatch"

  @integration
  Scenario: The door answers opsCopy:create only for a session approved for ops:copy
    Given a redeemed "ops:copy" session and a redeemed "ops:read" session
    Then the door permits "opsCopy:create" to the first and refuses it to the second

  @integration
  Scenario: A copy makes the source's projects and their setup in the target
    Given a live source approval for "ops:copy" and "org:content" on ACME
    And a live target approval for "ops:copy" and "org:support" on Globex
    And ACME has a project with an evaluator, a monitor on it, a prompt with two versions and a dataset
    When the agent copies ACME into Globex
    Then Globex has a new project with a new id and slug
    And the evaluator, the monitor, the prompt with both versions and the dataset are copied into it
    And the copied monitor is paused
    And the report says each item was copied

  @integration
  Scenario: A dry run lists what a copy would make and copies nothing
    Given live source and target approvals
    When the agent copies ACME into Globex as a dry run
    Then the report lists each item as planned
    And nothing is created in Globex and no audit row is written

  @integration
  Scenario: A rerun copies only what is new
    Given ACME was copied into Globex once
    And ACME gained a second prompt since
    When the agent copies ACME into Globex again
    Then only the new prompt is copied
    And everything copied before reads as already copied

  @integration
  Scenario: Kinds a copy cannot carry yet are skipped with a reason
    Given ACME has a workflow evaluator and a monitor attached to an experiment
    When the agent copies ACME into Globex
    Then both are reported as skipped with their reason

  @integration
  Scenario: A copy writes both trails and both organizations' audit logs before it copies
    When the agent copies ACME into Globex
    Then each approval has a trail row for the copy
    And ACME's and Globex's audit logs each hold a "staffAccess.orgCopy" row with the approver, the reason and the planned items

  @integration
  Scenario: A failed audit write copies nothing
    Given the audit log refuses writes
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_access_audit_unavailable"
    And nothing is created in Globex

  @integration
  Scenario: A copy with a source token that is no session is refused
    When the agent copies with a source ops token the server never issued
    Then the copy is refused with "staff_copy_source_invalid"

  @integration
  Scenario: A source approval that is no longer live does not pair with a new target approval
    Given the source approval's hour ran out
    And a target approval made after it
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_copy_window_closed"

  @integration
  Scenario: Approvals from different agents do not pair
    Given the source approval was made by another enrolled agent
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_copy_approvals_mismatch"

  @integration
  Scenario: Each side needs its own copy scopes
    Given a source approval for "ops:read" and "org:content" without "ops:copy"
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_copy_scope_missing"
    And a target approved for "ops:copy" with "org:content" instead of "org:support" is refused the same way

  @integration
  Scenario: A copy into the same organization is refused
    Given source and target approvals both on ACME
    When the agent copies ACME into ACME
    Then the copy is refused with "staff_copy_same_organization"

  @integration
  Scenario: The CLI asks one approval per organization and runs the copy
    When the agent runs "langwatch ops copy --from acme --to globex --dry-run"
    Then it requests "ops:copy" with "org:content" on acme and "ops:copy" with "org:support" on globex
    And it prints both approval URLs and waits for both
    And it sends the copy with the target's ops token and the source's ops token in the body
    And it ends both sessions afterwards

  @unimplemented
  Scenario: Scenarios and test suites are copied
    When the agent copies ACME into Globex
    Then ACME's scenarios and test suites are copied, scenarios pointing at the copied suites

  @unimplemented
  Scenario: Connected agents are copied as offline registrations
    When the agent copies ACME into Globex
    Then each connected agent is registered in Globex by name and environment, offline

  @unimplemented
  Scenario: Dashboards and their charts are copied
    When the agent copies ACME into Globex
    Then each dashboard and its charts are copied, pointing at the copied projects

  @unimplemented
  Scenario: Triggers are copied paused
    When the agent copies ACME into Globex
    Then each trigger is copied paused, with no email, Slack or webhook target firing

  @unimplemented
  Scenario: Workflows and workflow evaluators are copied
    When the agent copies ACME into Globex
    Then each workflow is copied with its latest version and its evaluator points at it

  @unimplemented
  Scenario: Traces, spans and their evaluations are copied
    When the agent copies ACME into Globex with trace data
    Then the source traces, spans and evaluation results land in the copied projects

  @unimplemented
  Scenario: Scenario runs and experiment runs are copied
    When the agent copies ACME into Globex with run data
    Then scenario runs and experiment runs land in the copied projects
