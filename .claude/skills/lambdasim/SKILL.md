---
name: lambdasim
description: "Run the studio's per-project NLP Lambda path locally with lambdasim, haven's AWS Lambda stand-in: functions, invokes and response streams answered on this stack's nlpgo. Use when someone says 'lambdasim', 'haven up +lambda', 'NLP Lambda locally', 'per-project Lambda', 'LANGWATCH_NLP_LAMBDA_CONFIG in dev', 'test the Lambda path without AWS', 'force a Lambda throttle', or 'InvokeWithResponseStream locally'."
user-invocable: true
---

# lambdasim

Answers the AWS Lambda and CloudWatch Logs calls the workflow module makes on its
per-project NLP Lambda fleet, and runs every invoke on this stack's nlpgo, framed the
way the image's Lambda Web Adapter frames it (`AWS_LWA_INVOKE_MODE=RESPONSE_STREAM`:
JSON prelude, eight zero bytes, body). Code: `services/lambdasim`, console
`apps/lambdasim-web`, spec `specs/setup/haven-lambdasim.feature`.

## Run it

- Opt-in: `haven up +lambda` (sticky; restarts the stack). Hosted in the `sims` lane.
- The overlay sets `LANGWATCH_NLP_LAMBDA_CONFIG` to a placeholder fleet and points
  `AWS_ENDPOINT_URL_LAMBDA` and `AWS_ENDPOINT_URL_CLOUDWATCH_LOGS` at lambdasim, so the
  workflow module takes the per-project path (studio streams and synchronous runs). A
  fleet `.env` names wins, and then nothing is pointed at lambdasim.
- Every invoke goes to `LAMBDASIM_TARGET`, this stack's nlpgo. The function's own
  environment (`LANGWATCH_ENDPOINT`, `CACHE_BUCKET`, ...) is recorded, not applied.
- Console: `https://lambda.<slug>.langwatch.localhost`. Standalone:
  `make service svc=lambdasim` (:5594, nlpgo assumed at :5562).

## What it fakes

```
GET|DELETE /2015-03-31/functions/{name}         GetFunction, DeleteFunction
POST       /2015-03-31/functions                 CreateFunction (409 when it exists)
PUT        /2015-03-31/functions/{name}/code|configuration
GET        /2015-03-31/functions                 ListFunctions (one page)
POST       /2015-03-31/functions/{name}/invocations                       Invoke
POST       /2021-11-15/functions/{name}/response-streaming-invocations    event stream
POST       /  (X-Amz-Target Logs_20140328.*)     log groups, retention, DescribeLogStreams
```

Functions live in memory. An invoke of an unknown name or ARN registers it rather than
404 (a cached ARN outlives a restart); force `not-found` to test the 404.

## Force a failure

`haven lambda set --error <kind>`, or the console's Forced error picker. Sticky until `none`.

| kind             | answer                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| `throttled`      | 429 TooManyRequestsException (the invoke lane retries)                             |
| `not-found`      | 404 ResourceNotFoundException                                                      |
| `function-error` | 200 + `X-Amz-Function-Error: Unhandled`; stream ends with InvokeComplete ErrorCode |
| `service`        | 500 ServiceException                                                               |

nlpgo unreachable is a function error too, naming the dial failure.

## Inspect and assert

```
GET    /_sim/api/info           stack, nlpgo target, functions, forced error
GET    /_sim/api/calls          newest first (function, mode, method, path, status, ms)
GET    /_sim/api/calls/{id}     with the event received and nlpgo's answer
DELETE /_sim/api/calls          reset; ids keep counting
GET|PUT /_sim/api/settings      {"forcedError": ""|"throttled"|"not-found"|"function-error"|"service"}
```

Caps: `LAMBDASIM_MAX_CALLS` (500) and `LAMBDASIM_MAX_BODY_BYTES` (65536 per body kept).

## From a terminal or agent

`--json` on reads; non-zero exit on failure; `--stack <slug>` reads another worktree.

```
haven lambda info | calls | call <id> | clear
haven lambda set --error <none|throttled|not-found|function-error|service>
```
