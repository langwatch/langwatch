Feature: Workflows reach AWS through OIDC roles, not stored keys
  As the person accountable for who can change our cloud accounts
  I want every workflow to assume a scoped IAM role with its OIDC token
  So that no long-lived AWS key sits in GitHub secrets where a workflow edit can read it

  # Enforced by `go run ./cmd/ciguard` (tools/ciguard/staticcloudkeys.go) in
  # go-ci. The roles are defined in langwatch-saas Terraform. The move to OIDC
  # is done: no stored-key fallback is allowed under any condition, and
  # break-glass is the AWS root account, not a key in GitHub.

  @unit
  Scenario: A workflow that reads a stored AWS key fails CI
    Given a workflow step, job or workflow env reads an AWS access key or secret key
    When ciguard runs
    Then it fails and names the file and line
    And it tells the author to assume a role with role-to-assume instead

  @unit
  Scenario: A composite action that reads a stored AWS key fails CI
    Given a composite action under .github/actions passes aws-access-key-id
    When ciguard runs
    Then it fails and names the action file and line

  @unit
  Scenario: A stored key fails CI whatever condition gates its step
    Given a stored-key step that runs only while a role variable is unset, or under any other condition
    When ciguard runs
    Then it fails and names each line that reads the key

  @unit
  Scenario: A change to a composite action runs the guard
    Given a pull request that only changes a file under .github/actions
    When go-ci decides which jobs to run
    Then the CI guards job runs
