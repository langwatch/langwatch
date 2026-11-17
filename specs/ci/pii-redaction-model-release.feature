Feature: A release publishes the PII redaction model image
  As a person running a self-hosted LangWatch
  I want langwatch/pii-redaction-model:<release> on Docker Hub, for my chip type, signed like the other images
  So that turning the model on in the chart pulls an image that exists and that I can verify

  # The model's code is private (langwatch-saas, DECISIONS 4.10 there). Its
  # main build pushes http-git-<sha> for amd64 and arm64 to the artifacts ECR.
  # The release copies the newest one unchanged; it never rebuilds it. The
  # chart release runs only after publish-docker-app succeeds, so a chart never
  # names a model image that was not published.

  @unit
  Scenario: The newest plain model image is picked
    Given the artifacts ECR holds several http-git-<sha> images and other tags
    When cmd/newestimage reads the repository
    Then it picks the http-git-<sha> image pushed last, by digest
    And it ignores tags without that prefix, such as the Lambda image's git-<sha>

  @unit
  Scenario: An image for one chip type only is refused
    Given the newest http-git-<sha> is a single-platform manifest
    Then cmd/newestimage fails and names the tag, because self-hosters run amd64 and arm64

  @unit
  Scenario: No plain model image fails the release
    Given the artifacts ECR holds no http-git-<sha> image
    Then cmd/newestimage fails, so the chart release does not run for this release

  @unit
  Scenario: The release copies, signs and attests the model image
    Given a langwatch@v release
    When publish-docker-app runs its pii-redaction-model job
    Then it reads ECR with the PII model reader role, by OIDC, with no stored key
    And copies the image to langwatch/pii-redaction-model as the version, and latest unless it is a prerelease
    And signs it keyless and attaches an SBOM per platform with .github/scripts/sign-image.sh, which verifies each signature
    And the chart release waits for this job, as it does for the other images
