Feature: Evaluation payload offload
  As the LangWatch evaluations pipeline persisting evaluator inputs
  I want oversized evaluation inputs offloaded to object storage with a
  bounded inline preview, instead of truncated or stored raw
  So that evaluation history keeps its full content, ClickHouse rows stay
  merge-safe, queue payloads stay lean, and offloaded bytes remain
  attributable to the tenant for storage accounting.

  # Incident lineage: 2026-05-29 and the stuck merge discovered 2026-07-10 -
  # raw JSON-stringified evaluator inputs (full conversation context) reached
  # GB-scale per row in evaluation_runs, making partition merges impossible
  # under the server memory cap. The 2026-06-02 write-time cap truncates at a
  # fixed byte budget: it protects the table but silently destroys evaluator
  # input content, and the evaluation events in event_log remain unbounded.
  # This feature replaces truncation with the offload pattern already proven
  # for trace payloads (ADR-022 lineage): bounded inline preview, full content
  # durable, transparent resolution on read.

  # Implementation notes (bindings live on the test cases as @scenario tags):
  #   - Offload decision + marker shaping + resolve fail-safe:
  #     src/server/app-layer/evaluations/evaluation-inputs-offload.ts
  #     (EVAL_INPUTS_INLINE_MAX_BYTES = 1 MiB, HARD_CEILING = 50 MiB, preview 16 KiB).
  #   - Write-time wiring (event carries the marker): the offload runs inside
  #     emitReported in executeEvaluation.command.ts BEFORE EventUtils.createEvent,
  #     flag-gated + fail-open at the composition root (pipelineRegistry.ts) on
  #     ON by default; the SYSTEM flag ops_evaluation_payload_offload_disabled
  #     is the operator kill switch. Disabled = inputs flow inline EXCEPT
  #     the unconditional repository cap below.
  #   - Belt-and-braces UNCONDITIONAL row cap (merge-safety, flag-independent):
  #     evaluation-run.clickhouse.repository.ts toClickHouseRecord via
  #     evaluation-column-caps.ts (Inputs -> valid-JSON __lw_truncated marker at
  #     8 MiB; Details/Error/ErrorDetails -> observable text truncation).
  #   - Read resolution seam: EvaluationService.getEvaluationInputs
  #     (evaluation.service.ts) resolves the marker; folds/reactors get it raw.
  #   - Billing ledger: stored_objects.size_bytes, summed by
  #     StoredObjectsService.getStorageUsageByProject; stored_objects added to
  #     MONITORED_TABLES (clickhouse/metrics.ts).
  # Integration coverage:
  #   src/server/app-layer/evaluations/__tests__/evaluation-payload-offload.integration.test.ts
  #   Unit coverage:
  #   evaluation-inputs-offload.unit.test.ts, evaluation-column-caps.unit.test.ts

  Background:
    Given the evaluations pipeline persists evaluator inputs with each run

  Scenario: an oversized evaluation input is offloaded, not truncated
    Given an evaluation run whose serialized inputs exceed the inline threshold
    When the evaluation run is persisted
    Then the stored row carries a bounded preview and a reference to the full content
    And the full inputs are stored durably in object storage under the tenant's scope
    And no truncation marker replaces the content

  Scenario: reading an offloaded evaluation run returns the full inputs
    Given an evaluation run whose inputs were offloaded
    When the evaluation run detail is read
    Then the returned inputs are byte-identical to what was persisted
    And the caller cannot tell whether the inputs were inline or offloaded

  Scenario: evaluation rows stay merge-safe regardless of input size
    Given evaluation runs with inputs of any size a tenant can produce
    When the runs are persisted
    Then every stored row remains below the merge-safe row budget
    And background merges of the evaluation store proceed without memory exhaustion

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
  @unimplemented
  Scenario: queue payloads for evaluation processing stay lean
    Given an evaluation reported with oversized inputs
    When the evaluation is processed through the job queue
    Then the staged job payload carries at most the bounded preview and the reference
    And processing resolves the full content only where the evaluator needs it

  Scenario: inputs beyond the hard ceiling are bounded with an observable marker
    Given an evaluation run whose serialized inputs exceed the hard ceiling
    When the evaluation run is persisted
    Then the content is bounded at the hard ceiling with an observable marker
    And a structured warning attributes the bound to the tenant and evaluation

  Scenario: offloaded bytes are recorded for storage accounting
    Given an evaluation run whose inputs were offloaded
    When the offload completes
    Then the offloaded object's byte size is recorded against the tenant
    And the tenant's storage usage reflects offloaded bytes alongside database bytes

  # The offload writes to the same content-addressed stored-objects service used
  # for scenario media and trace blobs, whose project-delete cascade
  # (StoredObjectsService.deleteOwnedBy, called from project.service.ts) already
  # removes every row and its bytes. Bound by the existing stored-objects cascade
  # integration test; marked @unimplemented here because no eval-specific cascade
  # code exists to bind (offloaded eval inputs are ordinary stored_objects rows).
  @unimplemented
  Scenario: deleting the project removes its offloaded evaluation content
    Given a project with offloaded evaluation inputs
    When the project's data is deleted
    Then the offloaded objects under that project's scope are removed
    And their bytes stop counting toward the tenant's storage usage

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
  Scenario: when the offload PUT fails, the evaluation completes with a bounded preview marker
    Given an evaluation run whose serialized inputs exceed the inline threshold
    And the object-storage PUT fails
    When the evaluation run is persisted
    Then the evaluation still records its result
    And the event payload carries a preview-only marker naming the failed offload
    And the event payload does not carry the full oversized inputs inline
    And a structured warning attributes the failure to the tenant and evaluation
