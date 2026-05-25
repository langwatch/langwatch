Feature: Auto S3 staging for large langevals payloads

  Background:
    Topic clustering and evaluator calls serialize per-trace input and output
    text into one HTTP POST to langevals. When langevals is fronted by API
    Gateway / Lambda the request body is capped at 6 MB; large batches and
    long-input evaluations hit 413 Request Too Long and fail the run.

    The control plane stages large payloads to S3 with a short-lived presigned
    GET URL and passes the URL to langevals via the X-Payload-S3-URL header.
    Langevals fetches the staged body and dispatches the request normally.
    Langevals never holds S3 credentials.

  @unit
  Scenario: Small eval payload posts inline
    Given the serialized request body is below the staging threshold
    When the control plane calls the evaluator endpoint
    Then the body is posted directly
    And no S3 object is created
    And no X-Payload-S3-URL header is sent

  @unit
  Scenario: Large topic clustering payload stages via presigned URL
    Given the serialized batch clustering body is above the staging threshold
    And the body is below the topic clustering hard cap
    When the control plane calls the batch clustering endpoint
    Then the body is uploaded to S3 under the project's staging prefix
    And a GET presigned URL is generated with the configured TTL
    And the URL is sent via the X-Payload-S3-URL header
    And the POST body is empty

  @unit
  Scenario: Staged S3 object is deleted after the upstream responds
    Given a payload was staged to S3 for an upstream call
    When the upstream langevals call returns
    Then the staged object is deleted from the same bucket and key
    And the delete failure is non-fatal because a bucket lifecycle rule reaps orphans

  @unit
  Scenario: Eval payload above the eval hard cap is rejected before any network call
    Given the serialized request body is larger than the evaluator hard cap
    When the control plane calls the evaluator endpoint
    Then the call fails with a PayloadTooLargeError
    And no S3 upload happens
    And no HTTP call is made to langevals

  @unit
  Scenario: Topic clustering payload above the eval cap but below the clustering cap stages successfully
    Given the serialized batch clustering body is above the evaluator cap but below the clustering cap
    When the control plane calls the batch clustering endpoint
    Then the body is staged via S3
    And the call succeeds

  @unit
  Scenario: Self-hosted langevals never stages regardless of payload size
    Given LANGEVALS_STAGING_THRESHOLD_BYTES is not configured
    When the control plane sends any payload to langevals
    Then the body is posted inline
    And no S3 upload happens

  # Langevals-side scenarios are implemented in Python tests under
  # langevals/tests/test_staged_payload.py. The feature-parity check
  # scans TS/Bats/Go test roots only; these scenarios stay untagged so
  # parity neither demands a TS binding nor a false @unimplemented label.

  Scenario: Langevals fetches the staged body and processes the request normally
    Given a presigned URL is received via X-Payload-S3-URL
    When langevals handles the incoming request
    Then langevals fetches the URL
    And the fetched body replaces the request body
    And the route handler parses the body using its normal schema

  Scenario: Langevals rejects a staged payload above its configured fetch cap
    Given a presigned URL points to an object larger than the langevals fetch cap
    When langevals attempts to fetch the staged body
    Then langevals returns 413 to the caller without invoking the route handler

  Scenario: Langevals returns a clear error if the staged URL fetch fails
    Given a presigned URL is unreachable or expired
    When langevals attempts to fetch the staged body
    Then langevals returns a 502-class error to the caller
    And the error body names the staging fetch as the failure cause

  Scenario: Langevals passes through requests without the staging header unchanged
    Given a request arrives without an X-Payload-S3-URL header
    When langevals handles the request
    Then the request body is used as-is
    And no outbound fetch is attempted

  # Not yet bound to a test — depends on an integration harness for BYOC
  # dataplane S3 routing. Tracked separately.
  Scenario: BYOC dataplane payloads stage to the customer's bucket
    Given the project's organization has a private dataplane S3 configured
    When a large payload is staged
    Then the upload targets the dataplane bucket, not the shared one
    And the presigned URL is signed with the dataplane credentials

  # Asserted out-of-band against the live IAM policy attached to the role,
  # not a code test. Documented here so the security invariant is visible.
  Scenario: nlpgo Lambda role grants no access to the staging prefix
    Given the langwatch-nlp-role IAM policy
    Then it has no s3 actions on any bucket other than langwatch-nlp-cache-339712859611
    And the langevals-lambda-role has no s3 actions at all
