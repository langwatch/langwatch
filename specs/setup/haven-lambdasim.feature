@unit
Feature: lambdasim, a local stand-in for the per-project NLP Lambda fleet
  When LANGWATCH_NLP_LAMBDA_CONFIG names a fleet, the workflow module resolves
  each project's own Lambda function (GetFunction, CreateFunction, the update
  calls), files its CloudWatch log group, and runs studio streams and
  synchronous runs on it with InvokeWithResponseStream and Invoke. lambdasim
  answers those Lambda and CloudWatch Logs calls and runs every invocation on
  the stack's own nlpgo, the way the real image's Lambda Web Adapter would, so
  the per-project path runs with no AWS account. It checks no signature.

  # Bound by Go tests in services/lambdasim/lambdasim_test.go,
  # tools/thuishaven/domain/overlay_lambda_test.go and
  # tools/thuishaven/app/plan_lambda_test.go and tools/thuishaven/cmd/sim_lambda_test.go, by their
  # `// @scenario` annotations, and by apps/lambdasim-web/src/__tests__/calls-console.integration.test.tsx.
  # The function's own environment (LANGWATCH_ENDPOINT, CACHE_BUCKET, ...) is
  # recorded, not applied: the local nlpgo runs with the stack's environment.

  Scenario: A project's function is created and read back
    Given lambdasim is running
    When the control plane asks GetFunction for a function that does not exist
    Then lambdasim answers 404 ResourceNotFoundException
    When it creates the function with an image, a memory size, a timeout and an environment
    Then GetFunction answers the same configuration, Active and Successful, with an ARN
    And a second CreateFunction for the same name answers 409 ResourceConflictException
    And UpdateFunctionCode and UpdateFunctionConfiguration change what GetFunction reads
    And ListFunctions lists it and DeleteFunction removes it

  Scenario: A synchronous invoke runs on nlpgo and answers in the adapter's framing
    Given a function and an nlpgo that answers a request with a status and a body
    When the control plane invokes the function with a function URL event
    Then nlpgo receives the event's method, path, query, headers and body
    And the invoke answers 200 with a payload of a JSON prelude naming nlpgo's status, eight zero bytes and nlpgo's body

  Scenario: A streaming invoke hands on nlpgo's body as it arrives
    Given a function and an nlpgo that streams server-sent events
    When the control plane invokes it with InvokeWithResponseStream
    Then the answer is an AWS event stream whose first PayloadChunk carries the prelude and separator
    And later PayloadChunks carry nlpgo's body in order
    And the stream ends with an InvokeComplete carrying no error code

  Scenario: An invoke of an unknown function still runs
    Given lambdasim restarted and forgot a function a cached ARN still names
    When the control plane invokes that ARN
    Then lambdasim registers the function and runs the invoke
    # A forced not-found (below) is how the 404 path is exercised.

  Scenario: An operator forces a Lambda failure
    Given the forced error is set to throttled, not-found, function-error or service
    When the control plane invokes a function
    Then throttled answers 429 TooManyRequestsException without reaching nlpgo
    And not-found answers 404 ResourceNotFoundException without reaching nlpgo
    And function-error answers 200 with X-Amz-Function-Error Unhandled without reaching nlpgo
    And service answers 500 ServiceException without reaching nlpgo
    And setting the forced error back to none lets the next invoke through

  Scenario: An nlpgo that cannot be reached is a function error
    Given the stack's nlpgo is down
    When the control plane invokes a function
    Then the invoke answers 200 with X-Amz-Function-Error Unhandled naming the failure

  Scenario: The CloudWatch log group calls are answered
    When the control plane creates a function's log group and sets its retention
    Then DescribeLogGroups lists it under its prefix
    And DescribeLogStreams names the function's last invoke as the last event time
    And DescribeLogStreams for an unknown group answers ResourceNotFoundException
    And DeleteLogGroup removes it

  Scenario: The console lists recent invocations
    Given two invocations have run
    When the console reads /_sim/api/calls
    Then it lists both newest first, each with its function, path, status and duration
    And /_sim/api/calls/{id} returns one invocation with its request and response bodies
    And DELETE /_sim/api/calls forgets them while ids keep counting
    And the call log keeps at most LAMBDASIM_MAX_CALLS (default 500)

  @integration
  Scenario: An operator reads an invocation and forces an error from the console
    Given the console lists an invocation
    When the operator selects it
    Then the event lambdasim received and nlpgo's answer open beside the list
    When the operator picks a forced error
    Then the console sends it to /_sim/api/settings and says every invoke now fails that way

  Scenario: haven runs lambdasim only when the worktree asks for it
    Given a worktree that has not said "haven up +lambda"
    Then no lambdasim lane runs and the overlay names no Lambda fleet
    When the worktree says "haven up +lambda"
    Then lambdasim runs in the sims lane, forwarding to this stack's nlpgo
    And the overlay sets LANGWATCH_NLP_LAMBDA_CONFIG to a placeholder fleet
    And it points AWS_ENDPOINT_URL_LAMBDA and AWS_ENDPOINT_URL_CLOUDWATCH_LOGS at lambdasim
    But a LANGWATCH_NLP_LAMBDA_CONFIG the developer named is left alone

  Scenario: An agent drives lambdasim from the terminal
    When the agent runs "haven lambda info", "calls", "call <id>", "clear" or "set --error <kind>"
    Then each is a thin client over lambdasim's /_sim/api, with --json on reads
