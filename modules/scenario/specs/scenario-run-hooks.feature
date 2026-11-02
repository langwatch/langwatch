Feature: Scenario run hooks: setup and teardown
  As a person who tests a connected or HTTP agent with scenarios
  I want the platform to run the agent's setup before the turns and its teardown after
  So that a scenario starts from known test data and leaves none behind.

  Background: how a run uses hooks.
    The order is setup, turns, teardown. Hooks run for scenario runs only.
    Parameters come from the run parameters, one value per name per run.
    The child sends each hook's result on its result line; the parent records
    it as a platform event folded into the run. Decided in ADR-180; an HTTP
    agent's setup and teardown are Connector steps LangWatch runs, decided in ADR-194.

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
    Scenario: An HTTP agent without a Connector and a code agent never call hooks
      Given an HTTP agent without a Connector
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

  # Decided in ADR-194: setup and teardown of an HTTP agent are code LangWatch stores and runs.
  Rule: Connector steps on an HTTP agent

    @integration
    Scenario: An HTTP agent with a Connector runs setup, then the turns, then teardown
      Given an HTTP agent whose Connector has a setup step and a teardown step
      When a scenario runs against it
      Then the code runner gets the setup step, the agent URL gets the turns, and the code runner gets the teardown step
      And the teardown step receives the state setup returned

    @unit
    Scenario: A Connector step runs only in the code runner
      Given a Connector step
      When it is called
      Then its code is posted to the code runner as the one code node of a workflow
      And the scenario child never evaluates the code itself

    @integration
    Scenario: A turn template reads the state and the run-scoped secrets setup returned
      Given a setup step that returns the state accountId "acc_1" and the run-scoped secret ACCOUNT_TOKEN
      When the turns are called
      Then each turn URL carries "acc_1"
      And each turn sends the ACCOUNT_TOKEN value in its header

    @unit
    Scenario: An HTTP turn template reads the state setup returned
      Given a run whose setup returned a state
      When an HTTP turn template renders {{ state }} and {{ state.NAME }}
      Then it renders the whole state as JSON and the named key as its value

    @unit
    Scenario: A Connector step receives only the secrets it names
      Given a project with the secrets API_KEY and OTHER_KEY
      And a setup step that names API_KEY
      When the run is prepared
      Then the step carries API_KEY and not OTHER_KEY

    @unit
    Scenario: A Connector step receives the run, its idempotency key and the run parameters
      Given a run with the parameter persona "gold"
      When the setup step and the teardown step are called
      Then each receives its kind, the run ids, the parameters and the key "<scenarioRunId>:<attemptId>:<kind>"
      And only the teardown step receives the state

    @unit
    Scenario: A Connector step bound to a dataset receives its rows
      Given a setup step bound to a dataset of two rows
      When the run is prepared and the step is called
      Then the step receives both rows

    @unit
    Scenario: Run-scoped secrets stay out of the record, the simulated user, the judge and every error
      Given a setup step that returns a run-scoped secret and puts the same value in its state
      When the run records setup and a turn fails echoing the value
      Then the recorded state holds "[redacted]" in its place
      And the turn error holds "[redacted]" in its place

    @integration
    Scenario: A Connector setup that raises leaves the run not scored and still runs teardown
      Given a setup step that raises an error
      When a scenario runs against the agent
      Then no turn is called
      And setup records "failed" with the traceback as its error
      And the teardown step was called once

    @integration
    Scenario: A Connector setup that does not answer in time records a timeout
      Given a setup step that runs past its budget
      When a scenario runs against the agent
      Then setup records "timed_out"
      And the teardown step was called once

    @unit
    Scenario: A Connector setup state over 64 KiB fails setup
      Given a setup step that returns a state over 64 KiB
      Then setup records "failed" naming the cap

    @unit
    Scenario: A Connector step that names a missing secret fails before it runs
      Given a setup step that names a secret the project does not have
      When setup is called
      Then the code runner is not called
      And setup records "failed" naming the secret

    @unit
    Scenario: A Connector step whose dataset is over 64 KiB fails before it runs
      Given a setup step bound to a dataset over 64 KiB
      When setup is called
      Then the code runner is not called
      And setup records "failed" naming the cap

    @unit
    Scenario: A secret in a Connector step's error is scrubbed
      Given a teardown step whose traceback prints a secret it was given
      Then the teardown error holds "[redacted]" in its place

    @unit
    Scenario: A failed Connector teardown leaves the verdict unchanged
      Given a passing run whose teardown step raises
      Then the run verdict is still success
      And teardown records "failed"

    @unit
    Scenario: Rerun and keep data skips a Connector teardown
      Given a run started with "Rerun and keep data" against an HTTP agent with a Connector
      Then the teardown step is not called
      And teardown records "skipped"

    @unit
    Scenario: A run of an HTTP agent with a Connector goes to the Node child
      Given an HTTP agent whose Connector has a setup step
      When the run is prepared
      Then the run calls hooks and is routed to the Node child

    @unit
    Scenario: The Connector config is checked when it is read
      Given a Connector step in a language the code runner does not offer, or code over 64 KiB, or a secret name that is not an identifier
      When the agent config is parsed
      Then it is refused

    # The Python code runner on main has no egress fence; ADR-194 waits on the WebAssembly runner for it.
    @integration @unimplemented
    Scenario: A Connector step's outbound calls pass the deployment's egress policy
      Given a deployment that refuses private and metadata addresses
      When a Connector step calls a metadata address
      Then the call is refused
