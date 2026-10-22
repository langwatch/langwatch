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
