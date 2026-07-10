Feature: Evaluation payload offload
  As the LangWatch evaluations pipeline persisting evaluator inputs
  I want oversized evaluation inputs offloaded to object storage with a
  bounded inline preview, instead of truncated or stored raw
  So that evaluation history keeps its full content, ClickHouse rows stay
  merge-safe, queue payloads stay lean, and offloaded bytes remain
  attributable to the tenant for storage accounting.

  # Incident lineage: 2026-05-29 and the stuck merge discovered 2026-07-10 —
  # raw JSON-stringified evaluator inputs (full conversation context) reached
  # GB-scale per row in evaluation_runs, making partition merges impossible
  # under the server memory cap. The 2026-06-02 write-time cap truncates at a
  # fixed byte budget: it protects the table but silently destroys evaluator
  # input content, and the evaluation events in event_log remain unbounded.
  # This feature replaces truncation with the offload pattern already proven
  # for trace payloads (ADR-022 lineage): bounded inline preview, full content
  # durable, transparent resolution on read.

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

  Scenario: deleting the project removes its offloaded evaluation content
    Given a project with offloaded evaluation inputs
    When the project's data is deleted
    Then the offloaded objects under that project's scope are removed
    And their bytes stop counting toward the tenant's storage usage
