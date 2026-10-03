Feature: The nlpgo invoke lane answers what nlpgo answered
  As a user whose evaluation, workflow or scenario turn runs on a per-project
    nlpgo Lambda
  I want a failure inside nlpgo to reach the caller as a failure, and my code to
    run at most once per turn
  So that an engine error is diagnosed instead of being read as an empty success,
    and a slow turn is not silently re-executed

  Background:
    On SaaS the per-project nlpgo engine is an AWS Lambda; self-hosted it is a
    plain HTTP URL. One helper, lambdaFetch, serves both, and callers read
    `ok`/`status`/`statusText`/`text()` from it without knowing which lane ran.

    The per-project function runs the Lambda Web Adapter with
    AWS_LWA_INVOKE_MODE=RESPONSE_STREAM (optimization_studio/server/lambda
    sets it), so an invoke response Payload is a JSON prelude carrying nlpgo's
    real statusCode, then eight zero bytes, then the body. The invoke's own
    StatusCode describes the INVOCATION, and is 200 whenever AWS ran the
    function at all, including when the function raised.

    # Bindings: platform/app/src/utils/__tests__/lambdaFetchResponse.unit.test.ts
    #           platform/app/src/utils/__tests__/lambdaFetchDeadline.unit.test.ts
    #           platform/app/src/utils/__tests__/lambdaFetchDispatcher.unit.test.ts
    #           platform/app/src/server/evaluators/__tests__/runCodeEvaluator.lambdaStatus.unit.test.ts
    # Sender: platform/app/src/utils/lambdaFetch.ts
    # Response framing: platform/app/src/utils/lwaPrelude.ts
    #   (platform/app/src/optimization_studio/server/lambda/__tests__/lwa-prelude.test.ts)

  Rule: The status a caller reads is nlpgo's, not the invocation's

    @unit
    Scenario: An engine error is reported as an error
      Given nlpgo answers a request with a 500 and an error body
      When the control plane invokes the per-project nlpgo Lambda
      Then the caller reads the response as not ok
      And the caller reads the status nlpgo set
      And the caller reads the body nlpgo sent, without the prelude

    @unit
    Scenario: An engine success is reported as a success
      Given nlpgo answers a request with a 200 and a result body
      When the control plane invokes the per-project nlpgo Lambda
      Then the caller reads the response as ok
      And the caller reads the body nlpgo sent, without the prelude

    @unit
    Scenario: Both lanes describe the same engine answer identically
      Given nlpgo answers a request with a given status and body
      When the same request is sent over the Lambda lane and over the HTTP lane
      Then both lanes report the same ok, status and body
      # Callers branch on `ok` with no idea which lane ran. While the Lambda
      # lane reported the invocation's status instead of the engine's, every
      # such branch was dead on SaaS and live self-hosted.

    @unit
    Scenario: A crash inside the function is not a success
      Given the Lambda reports a function error for the invocation
      When the control plane invokes the per-project nlpgo Lambda
      Then the caller reads the response as not ok
      And the status says the upstream engine failed
      And the function error names the failure in the status text
      # AWS returns StatusCode 200 with FunctionError set when the handler
      # raised, so reading StatusCode alone reads a crash as a success.

    @unit
    Scenario: A response with no prelude is still read
      Given an invoke response whose payload carries no prelude separator
      When the control plane invokes the per-project nlpgo Lambda
      Then the whole payload is read as the body
      And the invocation's own status is used
      # The adapter's invoke mode is deployment configuration, so the reader
      # must not corrupt a buffered-mode response if it ever changes.

    @unit
    Scenario: An empty body after the prelude stays empty
      Given nlpgo answers with a status and no body
      When the control plane invokes the per-project nlpgo Lambda
      Then the caller reads an empty body
      And the prelude is not mistaken for the body
      # Splitting the payload and taking the last non-empty segment returned
      # the PRELUDE as the body whenever the body was empty.

  Rule: A turn runs user code at most once

    @unit
    Scenario: An invoke that may have started the function is not retried
      Given the Lambda invoke fails in a way that does not prove the function never ran
      When the control plane invokes the per-project nlpgo Lambda
      Then the function is invoked exactly once
      And the error is reported to the caller
      # A retry re-runs the user's Python. At six attempts a single turn could
      # run a side-effecting code block six times.

    @unit
    Scenario: An invoke the service rejected before running is retried
      Given the Lambda control plane throttles the invoke
      When the control plane invokes the per-project nlpgo Lambda
      Then the invoke is retried
      And the function runs the user's code only once in total
      # Throttling is refused by the control plane before the function starts,
      # which is what makes retrying it safe. Cold-starting a fresh per-project
      # image bursts concurrency, so this retry is what keeps those turns alive.

    @unit
    Scenario: An invoke that never reached the service is retried
      Given the connection to the Lambda service is refused
      When the control plane invokes the per-project nlpgo Lambda
      Then the invoke is retried
      And the function runs the user's code only once in total
      # No request bytes left this process, so the function cannot have run.
      # A reset or a read timeout is different: either may have delivered the
      # request, so neither is retried.

    @unit
    Scenario: A staged payload survives a retry and is reaped once
      Given an oversized body was staged to S3 and the first invoke is throttled
      When the invoke is retried and succeeds
      Then the retried invoke still finds the staged object
      And the staged object is deleted once after the last attempt

  Rule: A deadline and a cancellation are honoured on both lanes

    @unit
    Scenario: A call past its deadline is abandoned on the Lambda lane
      Given a deadline shorter than the engine takes to answer
      When the control plane invokes the per-project nlpgo Lambda
      Then the call fails as a timeout
      And the caller can tell a timeout from a transport error

    @unit
    Scenario: A call past its deadline is abandoned on the HTTP lane
      Given a deadline shorter than the engine takes to answer
      When the control plane posts to a plain nlpgo URL
      Then the call fails as a timeout

    @unit
    Scenario: A cancelled turn stops the call on the Lambda lane
      Given a caller that cancels its own request
      When the caller cancels before the engine answers
      Then the call fails as cancelled, not as a timeout

    @unit
    Scenario: A turn cancelled before it is sent uploads nothing
      Given a caller whose request is already cancelled
      When the control plane would invoke the per-project nlpgo Lambda
      Then no payload is staged to S3
      And no invoke is attempted

    @unit
    Scenario: A caller with no deadline is unchanged
      Given a caller that sets neither a deadline nor a cancellation
      When the control plane sends a request on either lane
      Then no deadline is imposed on the call
      # Every caller that predates the deadline keeps its exact behaviour.

  Rule: A caller that needs a longer socket than undici's default can have one

    @unit
    Scenario: A dispatcher raises the HTTP lane's own timeouts
      Given a caller that needs to hold a socket longer than undici's 300s default
      When the caller passes the dispatcher that raises those timeouts
      Then the request is sent with that dispatcher
      And it is sent by the fetch belonging to the same undici package
      # undici's headersTimeout/bodyTimeout live on the dispatcher, and the
      # npm package rejects the global fetch's request handler outright
      # ("invalid onRequestStart method"). Pairing them is lambdaFetch's job so
      # that no caller can mismatch them. See specs/scenarios/nlp-fetch-transport.feature.

    @unit
    Scenario: A caller that passes no dispatcher uses the global fetch
      Given a caller that passes no dispatcher
      When the control plane posts to a plain nlpgo URL
      Then the request goes through the global fetch exactly as before
