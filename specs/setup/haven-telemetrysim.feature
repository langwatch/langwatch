@unit
Feature: telemetrysim, a seeded OTLP sender that haven drives at a stack
  Ingestion tests need traffic the product did not make itself: preset batches of
  traces, logs and metrics, a sustained rate, and fuzzed bodies whose every case
  can be replayed. telemetrysim runs in the sims mono-binary and sends to a
  stack's OTLP HTTP door. haven drives it through a small control API
  (start a run, stop it, read its counters). Payloads are synthesized from a
  seed; scrubbed recordings of real exports join them later under fixtures/.
  An OTLP gRPC sender waits for the gRPC receiver; only its seam exists.

  # Bound by Go tests in services/telemetrysim/telemetrysim_test.go and
  # tools/thuishaven/cmd/sim_telemetry_test.go, by their `// @scenario` annotations.

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
