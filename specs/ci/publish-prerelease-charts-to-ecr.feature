Feature: Publish every prerelease chart to the artifacts registry only
  As the team that deploys LangWatch Cloud
  I want every prerelease chart published beside our images in the artifacts registry, and nowhere public
  So that a deploy pulls both its image and its chart from one registry with one credential, and builds between releases stay private

  # These scenarios describe the ECR steps of
  # .github/workflows/prerelease-charts-oci.yml. The push is
  # `go run ./cmd/chartpush` (logic in tools/chartpush), bound by
  # tools/chartpush/chartpush_test.go against a stub helm.
  # Which registries the workflow reaches, and that nothing signs the ECR copy,
  # are the workflow's own shape, which no test suite can run: those scenarios
  # are @unimplemented and proved by the first run on main. Self-hosters are
  # unaffected: they install the tagged releases from the public Helm repo.

  @unit
  Scenario: A merge to main publishes every prerelease chart to ECR
    Given a merge to main changes a chart
    When prerelease-charts-oci runs for that commit
    Then each of langwatch, langwatch-gateway, clickhouse-serverless and langwatch-langyagent is pushed under langwatch-charts in the artifacts registry, at its prerelease version
    And the run summary lists each version and its digest

  @unimplemented
  Scenario: No prerelease chart goes to a public registry
    Given a merge to main changes a chart
    When prerelease-charts-oci finishes
    Then no chart was pushed to GHCR or any other public registry
    And the run holds no permission to write GitHub packages

  @unimplemented
  Scenario: The ECR copy is not signed
    Given the charts were pushed to the artifacts registry
    When prerelease-charts-oci finishes
    Then no signature names the artifacts registry, so its address stays out of the public transparency log

  @unit
  Scenario: A missing or ambiguous chart package fails the run
    Given the packaging step produced no package for a chart, or more than one
    When prerelease-charts-oci pushes to the artifacts registry
    Then it fails, naming the chart and how many packages it found

  @unit
  Scenario: A rejected push fails the run with the registry's reason
    Given the artifacts registry refuses the push
    When prerelease-charts-oci pushes a chart
    Then it fails and the log shows helm's error
    And no digest is written to the run summary
