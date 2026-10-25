Feature: Publish the prerelease charts LangWatch Cloud deploys to the artifacts registry
  As the team that deploys LangWatch Cloud
  I want the prerelease charts we deploy published beside our images in the artifacts registry
  So that a deploy pulls both its image and its chart from one registry with one credential

  # These scenarios describe the ECR steps of
  # .github/workflows/prerelease-charts-oci.yml. They call helm and the
  # registry, which no test suite here can run, so they are @unimplemented and
  # are proved by the first run on main. Self-hosters are unaffected: they
  # install the tagged releases from the public Helm repo, and every prerelease
  # is still published and signed on GHCR.

  @unimplemented
  Scenario: A merge to main publishes the langyagent prerelease chart to ECR
    Given a merge to main changes a chart
    When prerelease-charts-oci runs for that commit
    Then langwatch-charts/langwatch-langyagent in the artifacts registry has the same prerelease version as GHCR
    And it is the same chart package the GHCR push used
    And the run summary lists that version and its digest

  @unimplemented
  Scenario: The ECR copy is not signed
    Given the langyagent chart was pushed to the artifacts registry
    When prerelease-charts-oci finishes
    Then no signature names the artifacts registry, so its address stays out of the public transparency log
    And the GHCR copy of the same version is signed and verified

  @unimplemented
  Scenario: A missing or ambiguous chart package fails the run
    Given the packaging step produced no langwatch-langyagent package, or more than one
    When prerelease-charts-oci pushes to the artifacts registry
    Then it fails, naming the chart and how many packages it found

  @unimplemented
  Scenario: A rejected push fails the run with the registry's reason
    Given the artifacts registry refuses the push
    When prerelease-charts-oci pushes the langyagent chart
    Then it fails and the log shows helm's error
    And no digest is written to the run summary
