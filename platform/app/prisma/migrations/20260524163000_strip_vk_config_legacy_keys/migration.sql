-- Strip the now-legacy keys from vk.config:
--   - modelAliases (moved to RoutingPolicy.modelAliases in step i)
--   - policyRules (moved to RoutingPolicy.policyRules in step i)
--   - guardrails (lifted to top-level GatewayGuardrail rows in step ii)
--
-- Safety guard runs FIRST: RAISE EXCEPTION if any VK still has
-- non-empty content in any of the three keys. Forces an operator
-- running the migration against a prod-shape DB to run the backfill
-- walk first (scripts/migrations/backfill-vk-config-to-rp.ts) which
-- mints 1:1 RoutingPolicy + RoutingPolicyScope rows + lifts guardrails
-- to GatewayGuardrail rows + sets vk.routingPolicyId, then re-runs
-- this migration which strips the now-empty keys. The dogfood + the
-- PR-test environments have only empty-default content (e.g.
-- guardrails.{pre,post,streamChunk}: [], policyRules.{tools,mcp,urls,
-- models}.deny: []) so the guard passes through cleanly. See
-- specs/ai-gateway/governance/routing-policy-scope-cascade.feature
-- L72-87 for the backfill contract.
--
-- Forward-only. Down migration would restore the keys but the data is
-- already gone, so it would only reset defaults — meaningless reverse.

DO $$
DECLARE
  unsafe_count INT;
BEGIN
  -- "Non-empty" predicate:
  --   modelAliases: object with at least one key
  --   policyRules: object where any of tools/mcp/urls/models has deny[] non-empty or allow not null
  --   guardrails: object where any of pre/post/streamChunk has at least one ref
  SELECT count(*) INTO unsafe_count
  FROM "VirtualKey"
  WHERE
    (
      jsonb_typeof(config -> 'modelAliases') = 'object'
      AND (SELECT count(*) FROM jsonb_object_keys(config -> 'modelAliases')) > 0
    )
    OR (
      jsonb_typeof(config -> 'policyRules') = 'object'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each(config -> 'policyRules') AS dim(key, val)
        WHERE
          jsonb_typeof(val -> 'deny') = 'array'
            AND jsonb_array_length(val -> 'deny') > 0
          OR (val -> 'allow') IS NOT NULL
            AND (val -> 'allow') <> 'null'::jsonb
            AND jsonb_array_length(val -> 'allow') > 0
      )
    )
    OR (
      jsonb_typeof(config -> 'guardrails') = 'object'
      AND (
        jsonb_array_length(COALESCE(config -> 'guardrails' -> 'pre', '[]'::jsonb)) > 0
        OR jsonb_array_length(COALESCE(config -> 'guardrails' -> 'post', '[]'::jsonb)) > 0
        OR jsonb_array_length(COALESCE(config -> 'guardrails' -> 'streamChunk', '[]'::jsonb)) > 0
      )
    );

  IF unsafe_count > 0 THEN
    RAISE EXCEPTION
      E'Refusing to strip vk.config legacy keys: % VirtualKey row(s) still carry non-empty modelAliases / policyRules / guardrails content. Run scripts/migrations/backfill-vk-config-to-rp.ts FIRST to mint 1:1 RoutingPolicy / GatewayGuardrail rows + set vk.routingPolicyId, then re-run this migration. See specs/ai-gateway/governance/routing-policy-scope-cascade.feature L72-87.',
      unsafe_count;
  END IF;
END $$;

UPDATE "VirtualKey"
SET config = (config - 'modelAliases' - 'policyRules' - 'guardrails')::jsonb;
