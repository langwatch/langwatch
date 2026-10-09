@unit
Feature: telemetrysim, a seeded OTLP sender that haven drives at a stack
  Ingestion tests need traffic the product did not make itself: preset batches of
  traces, logs and metrics, a sustained rate, and fuzzed bodies whose every case
  can be replayed. telemetrysim runs in the sims mono-binary and sends to a
  stack's OTLP HTTP door. haven drives it through a small control API
  (start a run, stop it, read its counters). Payloads are synthesized from a
  seed; scrubbed recordings of real exports join them later under fixtures/.
  An OTLP gRPC sender waits for the gRPC receiver; only its seam exists.

  # Bound by Go tests in services/telemetrysim (telemetrysim_test.go, runs_test.go),
  # tools/thuishaven (cmd/sim_telemetry_test.go, app/plan_telemetry_test.go) and the
  # console's tests in apps/telemetrysim-web/src/__tests__, by their @scenario annotations.

  Scenario: A preset sends a seeded, reproducible batch
    Given a preset, a seed, a batch index and a run start
    When telemetrysim builds the batch twice
    Then both bodies are byte-identical
    And another seed builds a different body

  Scenario: Presets cover traces, logs and metrics over OTLP HTTP in protobuf and JSON, gzipped
    Given the presets llm-trace, claude-code-session, codex-session, logs and metrics
    When each is built as gzipped protobuf and as JSON
    Then the protobuf decodes as its signal's OTLP export request
    And the JSON carries hex trace ids and numeric enums, as OTLP JSON requires

  Scenario: A sustained run holds its target rate and reports sent, acked and refused counts
    Given a door that refuses every fourth request
    When a load run sends at 100 batches a second for 300 milliseconds
    Then about 30 batches are sent, never more than the rate allows
    And every sent batch is counted once as acked, refused or failed

  Scenario: Fuzzing mutates within a seeded budget and records each mutation id for replay
    Given a fuzz run with a seed and a budget of 20
    When it runs twice with the same seed
    Then both runs record the same 20 mutation ids
    And rebuilding a case from its mutation id gives the exact bytes the door received

  Scenario: A refused send is counted and not retried forever
    When the door answers 503 to every request
    Then the batch is retried at most twice and counted refused
    And a 400 is counted refused without a retry

  Scenario: The control API starts, stops and reports a run
    Given a load run is going
    When another run is started
    Then it is refused with 409
    And stopping the run marks it stopped
    And the status never carries the project key

  Scenario: haven telemetry targets the worktree's own stack with the overlay key, never printing it
    Given a worktree whose stack overlay names its app URL and project key
    When the developer runs "haven telemetry send --preset logs --seed 7"
    Then telemetrysim is asked to send to that stack's /api/otel with that key
    And a worktree with no stack is told to run haven up or pass --target

  Scenario: A run reports its answers by status, the Retry-After it was given and its latency percentiles
    Given a door that answers 429, then 200, then 415, then 503 to every request after
    When a send run of three batches runs
    Then the run counts every attempt's status, retries included: 429, 200, 415 and three 503s
    And it counts four Retry-After headers and keeps the last value
    And it reports p50, p90, p99 and max latency over the attempts it made

  Scenario: Runs are listed newest first and each opens by id with its mutations
    Given a send run and then a fuzz run of three mutations
    When the runs are listed
    Then the fuzz run comes first, the send run second, neither with its mutations
    And opening the fuzz run by id, or as "current", shows its three mutations
    And the fuzz run keeps its mutations once a later run replaces it
    And an unknown run id is refused with 404

  Scenario: The console lists runs and opens one with its rate, answers by status, Retry-After and latency
    Given telemetrysim reports a running load run and an earlier send run
    When the developer opens the console's Runs tab
    Then both runs are listed and the current one opens
    And its detail names 415 unsupported content type, 429 rate limited and 503 unavailable
    And it shows how many Retry-After headers came back, its latency percentiles and its sent total
    And the Stop button stops the running run

  Scenario: Send one posts a single OTLP request and shows the door's answer
    Given a door that answers 429 with Retry-After 2
    When the developer sends one metrics batch as JSON from the console or "haven telemetry post"
    Then the answer names the URL, signal, encoding, size, status, Retry-After, latency and the door's body
    And no run is started and the project key is never in the answer

  Scenario: Send one converts a pasted OTLP JSON body and refuses one it cannot read
    Given a pasted OTLP JSON logs export request
    When it is sent as protobuf
    Then the door receives one protobuf body on /v1/logs
    And a body with no resourceSpans, resourceLogs or resourceMetrics is refused with 400
    And so are a non-JSON body, one protobuf cannot read, an unknown preset or fixture, an unknown encoding and a non-http(s) endpoint
    And none of the refused requests reaches the door

  Scenario: The fixtures browser lists presets and recordings and shows each body
    Given the presets and a recording under fixtures/claude-code/session.otlp.json
    When the fixtures are listed
    Then every preset is listed, then the recording as claude-code/session with its signal
    And a file that is not an OTLP JSON export request is left out
    And a preset's body is built from the seed asked for, a recording's is served as committed
    And either can be sent to the door from the console, and an unknown fixture is refused with 404

  Scenario: The setup shows the target, where the key came from and its project, never the key
    Given haven starts telemetrysim with the stack's OTLP door, seeded key and seeded project
    When the developer opens the console's Setup tab
    Then it shows the OTLP base, the key's first six and last four characters with its source, and the project
    And a key shorter than sixteen characters shows only that one is set
    And a sim started without haven says every run must name its endpoint and key

  Scenario: haven telemetry post, runs, run, fixtures and console drive the sim's API
    When the developer runs "haven telemetry post", "runs", "run <id>", "fixtures" or "fixture <name>"
    Then each calls the sim's matching endpoint and prints its answer, or its JSON with --json
    And "post" exits zero when the door refuses, since a refusal is an answer
    And "run" without an id prints its usage, and an unknown verb fails
    And "console" prints the console URL
