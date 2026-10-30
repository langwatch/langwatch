Feature: Scenario run hooks: setup and teardown
  As a person who tests a connected or HTTP agent with scenarios
  I want the platform to run the agent's setup before the turns and its teardown after
  So that a scenario starts from known test data and leaves none behind.

  Background: how a run uses hooks.
    The order is setup, turns, teardown. Hooks run for scenario runs only.
    Parameters come from the run parameters, one value per name per run.
    The child sends each hook's result on its result line; the parent records
    it as a platform event folded into the run. Decided in ADR-180; an HTTP
    agent calls its hooks over a hooks URL, decided in ADR-188.

  Rule: Order and state

    @integration
    Scenario: A run calls setup, then the turns, then teardown
      Given a connected agent that declares both hooks
      When a scenario runs against it
      Then the calls arrive in the order setup, turn, turn, teardown

    @integration
    Scenario: The state from setup reaches every turn and the teardown
      Given a setup that returns the state "order 42"
      When a scenario runs with two turns
      Then each turn call carries "order 42"
      And the teardown call carries "order 42"

    @integration
    Scenario: A turn's state update replaces the state for later calls
      Given a turn that returns the state update "order 43"
      When the next turn and the teardown are called
      Then both carry "order 43"

    @unit
    Scenario: The simulated user and the judge see the current state each turn
      Given a run whose state is "order 42"
      When the simulated user and the judge are given a turn
      Then both read "order 42"
      And after a state update both read the update on the next turn

    @unit
    Scenario: Hook parameters use the same value as the agent for the same run
      Given the run parameter loyalty_tier is "gold"
      When setup, a turn and teardown are called
      Then each receives loyalty_tier "gold"

  Rule: Teardown always runs

    @integration
    Scenario: Teardown runs after a passing run
      Given a run that passes
      Then teardown was called once

    @integration
    Scenario: Teardown runs after a failing run
      Given a run whose judge fails
      Then teardown was called once

    @integration
    Scenario: Teardown runs after setup fails
      Given a setup that raises an error
      Then no turn is called
      And teardown was called once

    @integration @unimplemented
    Scenario: Teardown after a failed setup receives the partial state
      Given a setup that fails after reporting partial state
      Then the teardown call carries that partial state

    @integration
    Scenario: Teardown runs after setup times out
      Given a setup that does not answer within its timeout
      Then teardown was called once

    @integration @unimplemented
    Scenario: Teardown runs when the run is cancelled
      Given a run cancelled during the turns
      Then teardown was called once

    @unit
    Scenario: The child runs teardown in a finally
      Given a child whose turns throw
      When the child exits its run
      Then teardown was attempted before the result line was written

    # Decided in principle. The mechanism is open.
    @integration @unimplemented
    Scenario: A killed child gets a fallback teardown from the parent worker
      Given a child process killed after setup
      When the parent worker sees the child die
      Then the parent worker runs a teardown with the last known state
      And the run records the hook as run by the fallback

    @integration @unimplemented
    Scenario: A killed child that never finished setup gets no fallback teardown call without state
      Given a child killed before setup answered
      When the parent worker sees the child die
      Then the parent worker runs a teardown with no state

  Rule: Setup failure and scoring

    @integration
    Scenario: A run whose setup failed is not scored
      Given a setup that fails
      Then the run has no verdict
      And the run shows the setup error

    @integration
    Scenario: A run whose setup timed out is not scored
      Given a setup that exceeds its timeout
      Then the run has no verdict
      And the run shows a timeout error

    @unit
    Scenario: Setup failures are excluded from the batch pass rate
      Given a batch of 4 runs: 2 passed, 1 failed and 1 whose setup failed
      When the batch summary is computed
      Then the pass rate is 2 of 3
      And the summary counts 1 run as not scored

    @unit
    Scenario: Setup failures are excluded from the suite roll-up
      Given a suite whose latest batch has a run whose setup failed
      When the suite roll-up is computed
      Then that run is not in the pass-rate denominator

    @unit
    Scenario: Server-side pass rates leave out a run whose setup failed
      Given a batch of 3 runs: 1 passed, 1 failed and 1 that finished ERROR because its setup failed
      When the batch counts, the set roll-up and the results stat strip are read
      Then the run whose setup failed is neither a failure nor in the pass-rate denominator
      And the results list reads it as "Not scored"

    @unit
    Scenario: A run whose setup failed is measured from its queued time
      Given a run that finished without starting, because its setup failed
      When its hook results are recorded
      Then its duration runs from the time it was queued
      But a run without a hooks record that never started keeps no duration

    @unit
    Scenario: A batch where every setup failed has no pass rate
      Given a batch whose runs all failed in setup
      When the batch summary is computed
      Then the pass rate is shown as not available, not as zero

  Rule: Teardown never changes the score

    @unit
    Scenario: A failed teardown leaves a passing verdict passing
      Given a run that passed and a teardown that raises
      Then the run verdict is still success
      And the run shows the teardown error

    @unit
    Scenario: A failed teardown leaves a failing verdict failing
      Given a run that failed and a teardown that raises
      Then the run verdict is still failure

    @unit
    Scenario: A failed teardown shows the state it was given and a warning
      Given a teardown that raises with the state "order 42"
      Then the run shows the state "order 42"
      And the run shows "Test data may be left behind."

    # The record keeps the status timed_out; the run reads "Teardown failed" with the timeout error.
    @unit
    Scenario: A teardown that times out counts as failed
      Given a teardown that does not answer within its timeout
      Then the run shows "Teardown failed" with the timeout error
      And the verdict is unchanged

    @unit
    Scenario: A teardown's returned object is shown on the run
      Given a teardown that returns { "deleted": 3 }
      Then the run shows { "deleted": 3 } as the teardown result

    @integration
    Scenario: A run opened from Agent testing shows its hooks
      Given a run opened from Agent testing whose setup failed and whose teardown returned an object
      Then the wide run drawer shows "Not scored", the Setup band with its error and the Teardown band with the object
      And it does not show "No response"

  Rule: Timeouts

    @unit
    Scenario: Each hook defaults to 60 seconds
      Given a scenario with no hook timeout
      Then the setup and teardown timeouts are 60 seconds

    @unit @unimplemented
    Scenario: A scenario sets its own hook timeout
      Given a scenario that sets a 120 second hook timeout
      Then the setup and teardown timeouts are 120 seconds

    @unit @unimplemented
    Scenario: A hook timeout is never longer than the child's lifetime
      Given a scenario that sets a hook timeout above the child's lifetime
      Then the scenario is refused with a message naming the limit

  Rule: Where hooks run

    @unit @unimplemented
    Scenario Outline: Surfaces other than a scenario run never call hooks
      Given a connected agent that declares both hooks
      When it is called from <surface>
      Then no setup or teardown call is made

      Examples:
        | surface              |
        | an experiment        |
        | the Test button      |
        | langwatch agent run  |

    @unit
    Scenario: An agent with no hooks runs as today and is marked "No hooks"
      Given a connected agent that declares no hooks
      When a scenario runs against it
      Then only turn calls are made
      And the run shows "No hooks"

    @unit
    Scenario: An HTTP agent without a hooks URL and a code agent never call hooks
      Given an HTTP agent without a hooks URL
      When a scenario runs against it
      Then the run shows "No hooks"

    @unit
    Scenario: An agent that declared only teardown gets only teardown
      Given an agent that declares teardown and not setup
      When a scenario runs against it
      Then no setup call is made
      And teardown is called with no state

    # Decided 2026-10-19 by Drew's assistant under delegation (reversible); see ADR 180.
    @integration
    Scenario: A run of an agent with hooks goes to the Node child when the Go runner is on
      Given a project with the release_scenario_go_runner_enabled flag on
      And an agent that declares hooks
      When a scenario runs against it
      Then the run is routed to the Node child

    # Decided 2026-10-19 by Drew's assistant under delegation (reversible); see ADR 180.
    @integration
    Scenario: A run of an agent without hooks still goes to the Go runner when the flag is on
      Given a project with the release_scenario_go_runner_enabled flag on
      And an agent that declares no hooks
      When a scenario runs against it
      Then the run is routed to the Go runner

  Rule: Rerun and keep data

    @integration
    Scenario: Rerun and keep data skips teardown for that rerun
      When a person reruns a run with "Rerun and keep data"
      Then setup and the turns run
      And teardown is not called
      And the run shows "Teardown skipped"

    @unit @integration
    Scenario: A run with no known target type offers no "Rerun and keep data" and is not marked "No hooks"
      Given a finished run whose target type is unknown and that recorded no hooks
      Then the run does not show "No hooks"
      And the run offers no "Rerun and keep data"

    @unit @unimplemented
    Scenario: Keep data is never saved to a plan
      Given a run started with "Rerun and keep data"
      When the person saves the run into a plan
      Then the saved plan does not carry keep data

    @unit
    Scenario: A teardown that did not happen by accident reads "Teardown not run"
      Given a run whose agent went offline before teardown
      Then the run shows "Teardown not run"
      And it does not show "Teardown skipped"

  Rule: Recording

    @unit
    Scenario: Each hook result is recorded on the run
      Given a child result line with a setup result and a teardown result
      When the job completes
      Then the run records, for each hook, its status, duration, trace, state or returned object and error

    @unit
    Scenario: A result line with no hook results records nothing
      Given a child result line with no hook results
      When the job completes
      Then nothing is recorded on the run

    @unit
    Scenario: Recording hooks after the run finished keeps the run finished
      Given a run that finished with the verdict "success"
      When the hook results are recorded
      Then the run keeps its status, its verdict and its finish time

    # Decided 2026-10-19 by Drew's assistant under delegation (reversible); see ADR 180.
    @unit
    Scenario: A hook's error is cut to the length the record keeps
      Given a hook result whose error is longer than 1000 characters
      When the result is recorded
      Then the record keeps the first 1000 characters of the error

    @unit
    Scenario: A failed setup whose record cannot be written is logged as an error
      Given a run whose setup failed
      When its hook results cannot be recorded
      Then the worker logs an error naming the run
      And the job does not fail

    @unit
    Scenario: Hook state over the cap is cut and marked
      Given a hook result whose state is over 64 KiB
      When the result is recorded
      Then the record marks the state as too large and keeps no partial copy

    @integration
    Scenario: The processor records hooks off the child's result line
      Given a scenario child that writes a result line naming a setup and a teardown result
      When the processor runs the job and the child exits
      Then the run records both hooks

  # Decided in ADR-188: an HTTP agent gets the same hooks over one signed hooks URL.
  Rule: Hooks on an HTTP agent

    @integration
    Scenario: An HTTP agent with a hooks URL calls setup, then the turns, then teardown
      Given an HTTP agent with a hooks URL and both hooks checked
      When a scenario runs against it
      Then the hooks URL gets the setup call, the turn URL gets the turns, and the hooks URL gets the teardown call
      And the teardown call carries the state setup returned

    @integration
    Scenario: An HTTP setup that fails leaves the run not scored
      Given an HTTP agent whose setup answers HTTP 500
      When a scenario runs against it
      Then no turn is called
      And the setup records the status and the body as its error
      And teardown was called once

    @integration
    Scenario: An HTTP teardown that fails does not change the score
      Given a passing run whose HTTP teardown answers HTTP 500
      Then the run verdict is still success
      And the teardown records its error

    @integration
    Scenario: An HTTP hooks URL on a private address is refused before any request
      Given the deployment blocks local HTTP calls
      And an HTTP agent whose hooks URL is a private address
      When setup is called
      Then no request is sent
      And the setup fails with an SSRF error

    @integration
    Scenario: An HTTP hooks URL that answers a redirect is refused
      Given an HTTP agent whose hooks URL answers HTTP 302, even to a public address
      When setup is called
      Then the redirect is not followed
      And the setup fails naming the redirect

    @unit
    Scenario: An HTTP hook answer that is not a JSON object fails the hook
      Given a setup that answers HTTP 200 with a body that is not a JSON object
      Then the hook fails with the status and the first 1000 characters of the body

    @unit
    Scenario: An HTTP hook that does not answer in time times out
      Given a setup that does not answer within its timeout
      Then the hook records the status timed_out
      And over the worker's real egress the request is aborted at the hook timeout

    @unit
    Scenario: An HTTP hook call is signed so the receiver can verify it
      Given an HTTP agent with a hooks signing secret
      When a hook is called
      Then it carries "X-LangWatch-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of t.body>", signed as webhook deliveries are
      And "@langwatch/webhook-verify" accepts it with that secret

    @unit
    Scenario: An HTTP hook is never sent unsigned
      Given an HTTP agent with a hooks URL and no signing secret
      When a hook is called
      Then no request is sent and the hook fails naming the missing secret

    @unit
    Scenario: A new hooks URL on another origin is refused when it would take a stored credential
      Given a saved HTTP agent with stored authentication
      When an update adds a hooks URL on another origin and leaves the authentication blank
      Then the update is refused for sending stored credentials to another origin

    @unit
    Scenario: A new hooks URL on another origin is refused when it would take the stored signing secret
      Given a saved HTTP agent with a stored hooks signing secret
      When an update adds a hooks URL on another origin and leaves the signing secret blank
      Then the update is refused for sending stored credentials to another origin

    @unit
    Scenario: A first hooks URL on the turn URL's origin keeps the stored credentials
      Given a saved HTTP agent with stored authentication and no hooks URL
      When an update adds a hooks URL on the origin of the turn URL and leaves the authentication blank
      Then the update is allowed

    @unit
    Scenario: A hooks URL on another origin is allowed when every credential is typed again
      Given a saved HTTP agent with stored authentication and a stored hooks signing secret
      When an update moves the hooks URL to another origin and supplies new values for all of them
      Then the update is allowed

    @unit
    Scenario: An HTTP hook call carries the run's idempotency key
      When the setup hook of the run "run_1" is called in its attempt "attempt_1"
      Then it carries "Idempotency-Key: run_1:attempt_1:setup"
      And its signed body carries "idempotencyKey": "run_1:attempt_1:setup"
      And the teardown of that attempt carries "run_1:attempt_1:teardown"

    @integration
    Scenario: A run executed again gets a new idempotency key
      Given the job queue delivers a run's execution a second time under the same run id
      When its setup is called again
      Then the key names a new attempt, so a receiver makes the data again

    @unit
    Scenario: An HTTP hook call outside a scenario run still carries a key
      Given a hook call with no scenario run id
      Then it carries "Idempotency-Key: <attempt>:<kind>"

    @unit
    Scenario: An HTTP hooks URL must use https
      Given the deployment blocks local HTTP calls
      And an HTTP agent whose hooks URL is "http://shop.example.com/hooks" or "http://127.0.0.1/hooks"
      When a hook is called
      Then no request is sent and the hook fails naming https

    @integration
    Scenario: Plain http reaches a hooks URL only at a local address where local addresses are allowed
      Given the deployment allows local HTTP calls
      When a hook is called on "http://127.0.0.1:8123/hooks"
      Then the call is sent
      But a hook on plain http to a public address is refused naming https, and nothing is sent

    @integration
    Scenario: A customer header cannot stand in for the LangWatch signature
      Given an HTTP agent with headers "x-langwatch-signature" and "idempotency-key" of its own
      When a hook is called
      Then the call carries only the signature and the key LangWatch set

    @unit
    Scenario: An HTTP hook answer over the state cap is cut off while it is read
      Given a setup that streams an answer longer than 64 KiB
      Then no more than 64 KiB is read
      And the hook fails naming the cap

    @integration
    Scenario: An HTTP hook answer is measured and parsed before secrets are scrubbed
      Given a setup that answers an object holding a secret value of the agent
      Then the state it records holds the placeholder in place of the value

    @unit
    Scenario: A new hooks URL on another origin is refused when the form sends the stored references back
      Given a saved HTTP agent whose authentication and signing secret are "{{ secrets.NAME }}" references
      When an update moves the hooks URL to another origin and sends one of those references back
      Then the update is refused for sending stored credentials to another origin
      And a reference sent back with other spacing or another case of its scheme is refused the same way

    @integration
    Scenario: A copy updated from its source takes no stored credential to a hooks URL on another origin
      Given a copy in another project that holds its own credentials and signing secret
      When its source sets a hooks URL on another origin than the copy's hooks URL, or its turn URL
      And the source is pushed to the copy, or the copy is synced from it
      Then the copy's credentials and signing secret arrive blank, with no previous signing secret
      But a source hooks URL on the copy's hooks origin keeps the copy's credentials and window

    @integration
    Scenario: A hooks URL with a template in its scheme or host is refused on save
      Given an HTTP agent whose hooks URL is "https://{{ params.host }}/hooks"
      When it is created or updated
      Then the save is refused, naming the scheme and host, and no project secret is made
      But a template in the path or the query of the hooks URL is saved

    @unit
    Scenario: Rotating the hooks signing secret keeps the old one valid for 24 hours
      Given a saved HTTP agent whose signing secret is the project secret the save made for it
      When the signing secret is rotated and the agent is saved
      Then the old project secret is kept as the previous signing secret until 24 hours later
      And every hook call in that window carries one v1 signature per secret, the new one first
      And a receiver holding either secret verifies the call

    @unit
    Scenario: A second rotation inside the window drops the oldest secret at once
      Given an HTTP agent whose signing secret was rotated less than 24 hours ago
      When the signing secret is rotated again
      Then the secret it replaced is the previous one, for 24 hours
      And the oldest project secret is deleted at once

    @unit
    Scenario: The replaced hooks signing secret stops signing and is deleted once it expires
      Given an HTTP agent whose signing secret was rotated more than 24 hours ago
      Then a hook call carries only the new secret's signature
      And the first save after the window closed deletes the old project secret
      But a secret the person picked, or one another agent still names, is kept

    @unit
    Scenario: Removing the hooks URL deletes the hooks signing secret
      Given a saved HTTP agent whose signing secret is the project secret the save made for it
      When the hooks URL is cleared and the agent is saved, with or without the secret's reference
      Then the config holds no signing secret and no previous one
      And the project secret is deleted, the previous one too, inside a rotation window

    @unit
    Scenario: An HTTP hook call sends the agent's headers, auth and run parameters
      Given an HTTP agent with a bearer token and the run parameter loyalty_tier "gold"
      When a hook is called
      Then it carries the bearer token
      And its body names the kind, the run and the parameter loyalty_tier "gold"

    @unit
    Scenario: An unchecked HTTP hook is not called
      Given an HTTP agent with a hooks URL and only teardown checked
      When a scenario runs against it
      Then no setup call is made

    @unit
    Scenario: An HTTP agent with no hooks URL calls no hooks
      Given an HTTP agent with hooks checked and no hooks URL
      Then the run calls no hooks and needs no Node child

    @unit
    Scenario: An HTTP turn template reads the state setup returned
      Given a setup that returned { "customer_id": "c_1" }
      When a turn body renders "{{ state.customer_id }}" and "{{ state }}"
      Then it sends "c_1" and the whole state as JSON

    @unit
    Scenario: An HTTP turn cannot change the state
      Given a setup that returned { "customer_id": "c_1" }
      When a turn answers with a body that names another state
      Then the teardown still carries { "customer_id": "c_1" }

    @unit
    Scenario: The hooks signing secret is saved as a project secret and never read back
      Given a hooks signing secret typed into an HTTP agent
      When the agent is saved
      Then the config keeps a "{{ secrets.NAME }}" reference to a new project secret
      And a read of the agent shows the reference, never the secret

    @unit
    Scenario: An update that omits the hooks signing secret keeps the stored reference
      Given a saved HTTP agent whose hooks signing secret is a "{{ secrets.NAME }}" reference
      When the agent is updated with a config that leaves the signing secret out
      Then the config still holds the same reference
      And no new project secret is created

    @unimplemented
    Scenario: The agent form shows a new signing secret once and can rotate it
      Given an HTTP agent form with no hooks URL
      When the person types a hooks URL
      Then the form shows a new signing secret to copy before saving
      And after the agent is saved, the form shows only that a secret is set, with a Rotate button
