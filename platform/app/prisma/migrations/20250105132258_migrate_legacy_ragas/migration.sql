UPDATE "Check" SET "checkType" = 'legacy/ragas_answer_correctness' WHERE "checkType" = 'ragas/answer_correctness';
UPDATE "Check" SET "checkType" = 'legacy/ragas_answer_relevancy' WHERE "checkType" = 'ragas/answer_relevancy';
UPDATE "Check" SET "checkType" = 'legacy/ragas_context_precision' WHERE "checkType" = 'ragas/context_precision';
UPDATE "Check" SET "checkType" = 'legacy/ragas_context_recall' WHERE "checkType" = 'ragas/context_recall';
UPDATE "Check" SET "checkType" = 'legacy/ragas_context_relevancy' WHERE "checkType" = 'ragas/context_relevancy';
UPDATE "Check" SET "checkType" = 'legacy/ragas_context_utilization' WHERE "checkType" = 'ragas/context_utilization';
UPDATE "Check" SET "checkType" = 'legacy/ragas_faithfulness' WHERE "checkType" = 'ragas/faithfulness';
