# Bound by Go tests in tools/workerrun (`go test ./tools/workerrun/...`), annotated `// @scenario`.
Feature: workerrun ingestion families
  As the team that ships ingestion
  I want workerrun to send telemetrysim's seeded payloads at every ingestion door
  So that each signal, source and refusal is proven by read-back or by a count by tenant

  Background:
    Given a stack whose app route workerrun reaches with its seeded project key
    And every payload is built by telemetrysim from a seed that mixes the run tag and the family
    And every send is an item in workerrun's summary, with its family, id, wire id and verdict

  # Error paths first

  @unit
  Scenario: an OTLP door refuses gRPC framing with 415
    Given the refusals family is chosen
    When workerrun sends a valid protobuf batch with content type "application/grpc" to the trace, log and metric doors
    Then each door answers 415
    And nothing is read back for those items

  @unimplemented
  Scenario: a body over 10 MiB is refused with 413
    Given the refusals family is chosen
    When workerrun sends a body one byte over 10 MiB to the trace door
    Then the door answers 413

  @unimplemented
  Scenario: a gzip body that inflates past the cap is refused with 413
    Given the refusals family is chosen
    When workerrun sends a small gzip body that inflates to more than 10 MiB
    Then the door answers 413

  @unimplemented
  Scenario: a wrong project key is refused with 401
    Given the refusals family is chosen
    When workerrun sends a valid batch with a key that is not the project's
    Then the door answers 401

  @unimplemented
  Scenario: a malformed body is refused with 400 and an empty one is accepted
    Given the refusals family is chosen
    When workerrun sends a truncated JSON batch and then an empty JSON batch
    Then the first answers 400 and the second answers 200

  @unit
  Scenario: a door that cannot hand a batch off answers 503, which is retried
    Given a door answers 503 to the first send of a batch
    When workerrun sends that batch
    Then workerrun sends it again after a pause
    And the item passes once the door answers 2xx

  @unit
  Scenario: a door that keeps answering 503 fails the item by its id
    Given a door answers 503 to every send
    When workerrun has sent the batch three times
    Then the item fails with "status 503"

  @unit
  Scenario: a 2xx answer that rejects part of the batch fails the item
    Given a door answers 200 with a partial success naming rejected spans
    When workerrun sends the batch
    Then the item fails naming the rejected count

  @unimplemented
  Scenario: governance OTLP over 10 MiB and a governance webhook over 1 MiB are refused with 413
    Given the governance-source family is chosen with a source id and its ingest key
    When workerrun sends an OTLP body one byte over 10 MiB and a webhook body one byte over 1 MiB to the source
    Then both answer 413

  @unit
  Scenario: a family whose setup is missing is skipped and says why
    Given the logs, metrics, gateway or governance-source family is chosen
    And the ClickHouse URL, gateway URL or governance source it needs is not set
    Then the family is reported skipped with the variable to set
    And no other family's verdict changes

  @unit
  Scenario: the gateway family refuses a gateway that is not a local stack
    Given the gateway URL names a host outside langwatch.localhost and loopback
    Then the gateway family is skipped, since only llmsim may answer behind it

  @unit
  Scenario: a hybrid run finds no row in the shared ClickHouse
    Given the logs or metrics family counts in the private ClickHouse
    And the shared ClickHouse URL is set as well
    When the item's rows are counted
    Then the private count equals the batch and the shared count is zero

  # Happy paths

  @unit
  Scenario: OTLP JSON and gzip protobuf traces read back by id
    Given the otlp-json and otlp-gzip families are chosen
    When workerrun sends each item's telemetrysim trace, as JSON and as gzip protobuf
    Then GET /api/traces/{traceId} answers each trace with its root span

  @unimplemented
  Scenario: a misconfigured exporter base still lands
    Given the alias family is chosen
    When workerrun sends traces to the doubled, trailing-slash and unversioned trace paths under /api
    Then each trace reads back by id

  @unimplemented
  Scenario: logs and metrics land under the project's tenant
    Given the logs and metrics families are chosen and a ClickHouse URL is set
    When workerrun sends each item's telemetrysim logs or metrics batch
    Then the item's records counted with FINAL by tenant and wire marker equal the batch

  @unit
  Scenario: Claude Code, Codex and other agent sessions read back
    Given the claude-code, codex and agents families are chosen
    When workerrun sends each item's telemetrysim agent session
    Then the trace reads back by id
    And GET /api/coding-agent/sessions/{sessionId}/events answers at least one event

  @unimplemented
  Scenario: gateway traffic reaches llmsim and its trace reads back
    Given the gateway family is chosen with a local gateway URL and a virtual key
    When workerrun sends a chat completion with its own traceparent
    Then the gateway answers 2xx
    And the trace reads back by id carrying the prompt marker

  @unimplemented
  Scenario: a governance source accepts traces, logs and metrics
    Given the governance-source family is chosen with a source id and its ingest key
    When workerrun sends telemetrysim batches to the source's OTLP doors
    Then each door answers 2xx with nothing rejected

  @unit
  Scenario: planted PII is not stored at the project's redaction level
    Given the pii family is chosen
    When workerrun sends a trace whose input carries a planted email and card number
    Then the trace reads back by id
    And neither planted value is in the answer
