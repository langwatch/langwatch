Feature: Auto S3 staging for large nlpgo Lambda invoke payloads
  As a user running a workflow or evaluation that serializes large per-trace
    input/output text
  I want the control plane to offload an oversized invoke body to S3 instead of
    inlining it into the AWS Lambda invoke
  So that big evaluations and workflows run instead of failing with
    "Request must be smaller than 6291456 bytes for the InvokeFunction operation"

  Background:
    On SaaS the per-project nlpgo engine is fronted by an AWS Lambda invoked via
    the SDK InvokeFunction operation, whose request Payload is capped at 6 MiB
    (6291456 bytes). Workflow and evaluation runs (the engine receives them as
    execute_flow / execute_component / execute_evaluation on /studio/execute_sync)
    regularly serialize past that cap.

    The langevals HTTP path and the optimization-studio invoke path already stage
    large bodies to S3 and pass a short-lived presigned GET URL via the
    X-Payload-S3-URL header. The nlpgo invoke sender (lambdaFetch) is the gap:
    the engine's receiver (readStudioRequestBody) already fetches the staged body
    when the header is present, and the S3 bucket/credentials are already wired,
    but the sender never staged, so oversized bodies were inlined and rejected.

    # Bindings: langwatch/src/utils/__tests__/lambdaFetch.unit.test.ts
    # Sender: langwatch/src/utils/lambdaFetch.ts (ARN branch)
    # Caller: langwatch/src/server/nlpgo/nlpgoFetch.ts (passes projectId)
    # Receiver (already wired): services/nlpgo/adapters/httpapi/staged_payload.go
    #   (readStudioRequestBody), called by executeSyncHandler in handlers.go

  @unit
  Scenario: A small invoke is sent inline
    Given the serialized invoke envelope is below the staging threshold
    When the control plane invokes the per-project nlpgo Lambda
    Then the body is sent inline in the invoke Payload
    And no S3 object is created
    And no X-Payload-S3-URL header is added

  @unit
  Scenario: A large invoke is staged via a presigned URL
    Given the serialized invoke envelope is above the staging threshold
    When the control plane invokes the per-project nlpgo Lambda
    Then the body is uploaded to S3 under the project's nlpgo staging prefix
    And a GET presigned URL is generated with the configured TTL
    And the invoke Payload carries an empty body and the X-Payload-S3-URL header
    And the invoke Payload is below the 6 MiB cap

  @unit
  Scenario: Staging triggers on the real serialized envelope, not the raw body
    Given a body that is below the threshold on its own but crosses it once
      escaped into the invoke envelope
    When the control plane invokes the per-project nlpgo Lambda
    Then the invoke is staged via S3
    # Inlining the raw-body size would under-count and let the invoke fail at the
    # 6 MiB cap; the decision is made against the actual over-the-wire envelope.

  @unit
  Scenario: A staged object is deleted after the invoke returns
    Given a payload was staged to S3 for a nlpgo invoke
    When the Lambda invoke returns
    Then the staged object is deleted from the same bucket and key
    And a delete failure is non-fatal because a bucket lifecycle rule reaps orphans

  @unit
  Scenario: Staging falls back to a built-in threshold when the env var is unset
    Given LANGEVALS_STAGING_THRESHOLD_BYTES is not configured
    And the serialized invoke envelope is above the built-in default threshold
    When the control plane invokes the per-project nlpgo Lambda
    Then the invoke is still staged via S3
    # So a deploy that forgets the env var does not silently re-expose the 6 MiB cap.

  @unit
  Scenario: A self-hosted HTTP nlpgo target never stages
    Given the nlpgo service is reached over a plain HTTP URL, not a Lambda ARN
    When the control plane sends any body to nlpgo
    Then the body is posted inline
    And no S3 upload happens
