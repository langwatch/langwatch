-- Point monitors and evaluators that name a retired Ragas evaluator at its
-- current equivalent.
--
-- Migration 20250105132258_migrate_legacy_ragas rewrote saved rows onto the
-- `legacy/ragas_*` slugs. Those slugs no longer resolve to anything: the
-- evaluators behind them are gone, so a row still carrying one names an
-- evaluator that cannot run, cannot be rendered in the configuration form and
-- cannot be saved past validation.
--
-- Four of the seven have a current evaluator that computes the same upstream
-- Ragas metric over field sets the saved mapping already supplies, so those
-- rows move. The mapping is by metric, not by name: the two context-precision
-- variants both land on `ragas/response_context_precision`, which selects
-- between the with-reference and the without-reference scorer depending on
-- whether an expected output is present, exactly as the two legacy evaluators
-- did separately.
--
--   legacy/ragas_faithfulness         -> ragas/faithfulness
--   legacy/ragas_answer_relevancy     -> ragas/response_relevancy
--   legacy/ragas_context_precision    -> ragas/response_context_precision
--   legacy/ragas_context_utilization  -> ragas/response_context_precision
--
-- The other three are left alone, deliberately. `legacy/ragas_context_relevancy`
-- has no successor at all, the metric was withdrawn upstream.
-- `legacy/ragas_context_recall` maps to `ragas/response_context_recall`, which
-- newly requires the model output, a field these rows were never configured to
-- provide, so moving them would produce a score computed on an empty response.
-- `legacy/ragas_answer_correctness` maps to `ragas/factual_correctness`, which
-- drops the embedding-similarity half of the score, so the number it returns is
-- not the number the monitor has been reporting. Rewriting either would replace
-- a visibly retired evaluator with a quietly wrong one. Those rows keep their
-- saved type, and the configuration form sends the user to pick a replacement.
--
-- `embeddings_model` is dropped from the settings of the evaluators that do not
-- accept it, so a migrated row holds the same settings a newly created one
-- would. `ragas/response_relevancy` takes all three legacy settings unchanged.

UPDATE "Monitor"
SET "checkType" = 'ragas/faithfulness',
    "parameters" = "parameters" - 'embeddings_model'
WHERE "checkType" = 'legacy/ragas_faithfulness';

UPDATE "Monitor"
SET "checkType" = 'ragas/response_relevancy'
WHERE "checkType" = 'legacy/ragas_answer_relevancy';

UPDATE "Monitor"
SET "checkType" = 'ragas/response_context_precision',
    "parameters" = "parameters" - 'embeddings_model'
WHERE "checkType" IN (
  'legacy/ragas_context_precision',
  'legacy/ragas_context_utilization'
);

UPDATE "Evaluator"
SET "config" = jsonb_set(
      "config",
      '{settings}',
      COALESCE("config" -> 'settings', '{}'::jsonb) - 'embeddings_model'
    ) || '{"evaluatorType": "ragas/faithfulness"}'::jsonb
WHERE "config" ->> 'evaluatorType' = 'legacy/ragas_faithfulness';

UPDATE "Evaluator"
SET "config" = "config" || '{"evaluatorType": "ragas/response_relevancy"}'::jsonb
WHERE "config" ->> 'evaluatorType' = 'legacy/ragas_answer_relevancy';

UPDATE "Evaluator"
SET "config" = jsonb_set(
      "config",
      '{settings}',
      COALESCE("config" -> 'settings', '{}'::jsonb) - 'embeddings_model'
    ) || '{"evaluatorType": "ragas/response_context_precision"}'::jsonb
WHERE "config" ->> 'evaluatorType' IN (
  'legacy/ragas_context_precision',
  'legacy/ragas_context_utilization'
);
