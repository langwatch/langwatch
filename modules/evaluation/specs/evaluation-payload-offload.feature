# Oversized payloads: ../../../dev/docs/adr/172-oversized-payloads-live-under-expirable-prefixes.md
Feature: Evaluation payload offload
  As the LangWatch evaluations pipeline persisting evaluator inputs
  I want oversized evaluation inputs offloaded to object storage with a
  bounded inline preview, instead of truncated or stored raw
  So that evaluation history keeps its full content, ClickHouse rows stay
  merge-safe, queue payloads stay lean, and offloaded bytes expire with the
  retention of the run they belong to.

  # Incident lineage: 2026-05-29 and the stuck merge discovered 2026-07-10 -
  # raw JSON-stringified evaluator inputs (full conversation context) reached
  # GB-scale per row in evaluation_runs, making partition merges impossible
  # under the server memory cap. The 2026-06-02 write-time cap truncates at a
  # fixed byte budget: it protects the table but silently destroys evaluator
  # input content, and the evaluation events in event_log remain unbounded.
  # This feature replaces truncation with the offload pattern already proven
  # for trace payloads (ADR-022 lineage): bounded inline preview, full content
  # in object storage, transparent resolution on read.
  #
  # Where the bytes live (ADR-172, superseding ADR-040's stored-object offload):
  # evaluation-inputs/r<class>/<projectId>/<sha256>.json, kind first and tenant
  # second, one operator lifecycle rule per retention class, no stored-object
  # record. A project's retention rounds up to the next class (90, 180, 365 or
  # 730 days); zero days and anything longer is r-indefinite, which stays until
  # the project is deleted. The marker records its full key (an additive field).

  # Implementation notes (bindings live on the test cases as @scenario tags):
  #   - Offload decision + marker shaping + resolve fail-safe:
  #     modules/evaluation/process/src/services/evaluation-inputs-offload.service.ts
  #     with the key grammar in rules/evaluation-input-object.rules.ts.
  #     (EVAL_INPUTS_INLINE_MAX_BYTES = 1 MiB, HARD_CEILING = 50 MiB, preview 16 KiB).
  #   - Write-time wiring (event carries the marker): the offload runs inside
  #     emitReported in evaluation-execution-intent.service.ts BEFORE EventUtils.createEvent,
  #     flag-gated + fail-open at the composition root (pipelineRegistry.ts) on
  #     ON by default; the SYSTEM flag ops_evaluation_payload_offload_disabled
  #     is the operator kill switch. Disabled = inputs flow inline EXCEPT
  #     the unconditional repository cap below.
  #   - Belt-and-braces UNCONDITIONAL row cap (merge-safety, flag-independent):
  #     clickhouse-evaluation.repository.ts toClickHouseRecord via
  #     its row cap helpers (Inputs -> valid-JSON __lw_truncated marker at
  #     8 MiB; Details/Error/ErrorDetails -> observable text truncation).
  #   - Read resolution seam: EvaluationService.getEvaluationInputs
  #     (evaluation.service.ts) resolves the marker; folds/subscribers get it raw.
  #   - Lifecycle: an operator rule per evaluation-inputs/r<days>/ class expires
  #     the object with the run; a missing object answers the preview (ADR-172).
  # Integration coverage:
  #   none: the scenarios are bound at the unit level over the object-storage
  #   repository on the memory destination.
  #   Unit coverage:
  #   modules/evaluation/process/src/services/__tests__/evaluation-inputs-offload.service.unit.test.ts

  Background:
    Given the evaluations pipeline persists evaluator inputs with each run

  @unit
  Scenario: an oversized evaluation input is offloaded, not truncated
    Given an evaluation run whose serialized inputs exceed the inline threshold
    When the evaluation run is persisted
    Then the stored row carries a bounded preview and a reference to the full content
    And the full inputs are stored under the evaluation-inputs prefix, kind first and tenant second, with no stored-object record
    And no truncation marker replaces the content

  @unit
  Scenario: the offload key is derived from the content and recorded in the marker
    Given two evaluation runs whose serialized inputs are byte-identical
    When both are offloaded
    Then both resolve to the same object key built from the content hash
    And each marker records the full key it was written to

  @unit
  Scenario: a marker that names another project's object is never read
    Given an evaluation run whose marker names an object under another project's prefix
    When the evaluation run detail is read
    Then no object is read
    And the returned inputs are the bounded preview carried by the row

  @unit
  Scenario: the offload key carries the retention class in force when it was written
    Given a project whose evaluation retention is a given number of days
    When an oversized input is offloaded
    Then the object key has the evaluation-inputs prefix, then the retention class, then the project, then the content hash
    And the class is the smallest published class that covers the retention
    And a retention of zero days or beyond the longest class is the indefinite class
    And a later retention change does not strand the object, because the marker records its key

  @unit
  Scenario: a run offloaded before the move is read from its old address
    Given an evaluation run whose marker was written when inputs were stored objects
    When the evaluation run detail is read
    Then the inputs are read from the project's old address built from the marker's content hash
    And no stored-object record is consulted

  @unit
  Scenario: an expired offload answers its preview and warns
    Given an evaluation run whose offloaded object has expired
    When the evaluation run detail is read
    Then the returned inputs are the bounded preview carried by the row
    And a structured warning attributes the missing object to the tenant and the object key
    And the read does not fail

  @unit
  Scenario: a filesystem destination keeps the inputs as a preview marker
    Given a project whose object storage is the local filesystem
    And an evaluation run whose serialized inputs exceed the inline threshold
    When the evaluation run is persisted
    Then no object is written
    And the event payload carries a preview-only marker naming the failed offload
    And the evaluation still records its result

  # Gap: the Azure confirmation is the objectRetentionConfirmed flag, which lands with the operator surface of ADR-172; until then an Azure destination is not refused.
  @unit @unimplemented
  Scenario: an Azure container whose retention rules are unconfirmed keeps the inputs as a preview marker
    Given a project whose object storage is an Azure container the operator has not confirmed
    And an evaluation run whose serialized inputs exceed the inline threshold
    When the evaluation run is persisted
    Then no object is written
    And the event payload carries a preview-only marker naming the failed offload
    And the evaluation still records its result

  @unit
  Scenario: reading an offloaded evaluation run returns the full inputs
    Given an evaluation run whose inputs were offloaded
    When the evaluation run detail is read
    Then the returned inputs are byte-identical to what was persisted
    And the caller cannot tell whether the inputs were inline or offloaded

  @unit
  Scenario: evaluation rows stay merge-safe regardless of input size
    Given evaluation runs with inputs of any size a tenant can produce
    When the runs are persisted
    Then every stored row remains below the merge-safe row budget
    And background merges of the evaluation store proceed without memory exhaustion

  @unit
  Scenario: evaluation events stay bounded in the event log
    Given an evaluation reported with oversized inputs
    When the evaluation event is appended to the event log
    Then the event payload carries the bounded preview and the content reference
    And the event payload does not carry the full oversized inputs inline

  # The evaluation command queue stages ExecuteEvaluationCommandData, which
  # carries only trace/evaluator ids - never the evaluator inputs. Inputs are
  # produced during execution and offloaded before the reported event is built,
  # so the queued command is already lean. Marked @unimplemented: there is no
  # separate queue-payload transform to bind; the invariant is structural.
  @unit @unimplemented
  Scenario: queue payloads for evaluation processing stay lean
    Given an evaluation reported with oversized inputs
    When the evaluation is processed through the job queue
    Then the staged job payload carries at most the bounded preview and the reference
    And processing resolves the full content only where the evaluator needs it

  @unit
  Scenario: inputs beyond the hard ceiling are bounded with an observable marker
    Given an evaluation run whose serialized inputs exceed the hard ceiling
    When the evaluation run is persisted
    Then the content is bounded at the hard ceiling with an observable marker
    And a structured warning attributes the bound to the tenant and evaluation

  # Gap: project deletion records no project-deleted fact yet and the object-storage client has no prefix delete; ADR-172 adds both.
  @unit @unimplemented
  Scenario: deleting the project removes its offloaded evaluation content
    Given a project with offloaded evaluation inputs
    When the project is deleted
    Then the evaluation module deletes the project's objects under every evaluation-inputs retention class
    And no object remains under that project's evaluation-inputs prefix

  # Fail-open, bounded: the offload is a protective transform, never a gate on
  # producing the evaluation result. If object storage rejects the PUT (S3
  # outage, bad credentials), the evaluation still completes, but the payload
  # degrades to a preview-only marker instead of re-inlining the raw inputs:
  # event_log.EventPayload and the fold must stay bounded precisely under the
  # partial-failure paths this feature exists for. Full input recovery is
  # unavailable for runs reported during the storage outage, observable via
  # the marker's offloadFailed flag and a structured warning; the
  # unconditional repository row cap remains the backstop for writers that
  # bypass the offload entirely.
  @unit
  Scenario: when the offload PUT fails, the evaluation completes with a bounded preview marker
    Given an evaluation run whose serialized inputs exceed the inline threshold
    And the object-storage PUT fails
    When the evaluation run is persisted
    Then the evaluation still records its result
    And the event payload carries a preview-only marker naming the failed offload
    And the event payload does not carry the full oversized inputs inline
    And a structured warning attributes the failure to the tenant and evaluation
