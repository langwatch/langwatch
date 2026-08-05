-- Fix evaluators with max_tokens=128000 that are using models that don't support it
-- This updates max_tokens to 4096 for evaluators where:
-- 1. settings.max_tokens = 128000
-- 2. settings.model does NOT contain 'gpt-5' (which actually supports 128k)

UPDATE "Evaluator"
SET config = jsonb_set(
  config,
  '{settings,max_tokens}',
  '4096'::jsonb
)
WHERE
  config->'settings'->>'max_tokens' = '128000'
  AND config->'settings'->>'model' IS NOT NULL
  AND config->'settings'->>'model' NOT LIKE '%gpt-5%';
