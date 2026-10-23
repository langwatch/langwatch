Feature: Workflows reach AWS through OIDC roles, not stored keys
  As the person accountable for who can change our cloud accounts
  I want every workflow to assume a scoped IAM role with its OIDC token
  So that no long-lived AWS key sits in GitHub secrets where a workflow edit can read it

  # Enforced by `go run ./cmd/ciguard` (tools/ciguard/staticcloudkeys.go) in
  # go-ci. The roles are defined in langwatch-saas Terraform. While a workflow
  # moves over, its stored-key step may stay behind a gate on the role
  # variable being unset; tools/ciguard lists which variables may gate which
  # workflow, and removing an entry bans that fallback for good.

  @unit
  Scenario: A workflow that reads a stored AWS key fails CI
    Given a workflow step, job or workflow env reads an AWS access key or secret key
    And the step is not a sanctioned OIDC fallback
    When ciguard runs
    Then it fails and names the file and line
    And it tells the author to assume a role with role-to-assume instead

  @unit
  Scenario: A composite action that reads a stored AWS key fails CI
    Given a composite action under .github/actions passes aws-access-key-id
    When ciguard runs
    Then it fails and names the action file and line

  @unit
  Scenario: A gated stored-key fallback with an OIDC twin passes during the move
    Given a stored-key step that runs only while its listed role variable is unset
    And the same job assumes that role by OIDC when the variable is set
    And the job grants id-token write
    When ciguard runs
    Then it passes

  @unit
  Scenario: A fallback gated on an unlisted variable fails CI
    Given a stored-key step gated on a role variable not listed for that workflow
    When ciguard runs
    Then it fails, so a new stored key cannot hide behind a new variable

  @unit
  Scenario: A stored-key fallback without an OIDC twin fails CI
    Given a stored-key step gated on a listed role variable
    And its job has no step assuming a role, or does not grant id-token write
    When ciguard runs
    Then it fails

  @unit
  Scenario: A fallback gate that can run while the role variable is set fails CI
    Given a stored-key step whose condition tests the role variable is unset
    But the condition also has an "or" branch or wraps the test in parentheses
    When ciguard runs
    Then it fails, because the step can still run once the role is in use

  @unit
  Scenario: A stored key outside the sanctioned fallback step fails CI
    Given a workflow with a sanctioned stored-key fallback step
    And another step in the same file reads a stored AWS key
    When ciguard runs
    Then it fails and names only the line outside the fallback step

  @unit
  Scenario: A fallback whose job's effective permissions lack id-token write fails CI
    Given the workflow grants id-token write
    But the fallback's job declares its own permissions without id-token write
    When ciguard runs
    Then it fails, because a job's permissions replace the workflow's
    And a job granted write-all counts as granting id-token write

  @unit
  Scenario: A fallback that assumes the role with its own stored key fails CI
    Given a stored-key step that also sets role-to-assume
    And no separate credentials step assumes that role only while the variable is set
    When ciguard runs
    Then it fails, because assuming a role with a stored key still needs the key

  @unit
  Scenario: A change to a composite action runs the guard
    Given a pull request that only changes a file under .github/actions
    When go-ci decides which jobs to run
    Then the CI guards job runs

  @unit
  Scenario: A listed fallback variable with no fallback step left fails CI
    Given a role variable is listed as a sanctioned fallback for a workflow
    And that workflow is gone or no longer gates any stored-key step on it
    When ciguard runs
    Then it fails and asks for the entry to be deleted, so the list only shrinks
