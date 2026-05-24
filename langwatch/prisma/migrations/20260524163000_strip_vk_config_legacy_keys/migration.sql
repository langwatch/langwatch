-- Strip the now-legacy keys from vk.config:
--   - modelAliases (moved to RoutingPolicy.modelAliases in step i)
--   - policyRules (moved to RoutingPolicy.policyRules in step i)
--   - guardrails (lifted to top-level GatewayGuardrail rows in step ii)
--
-- Forward-safety: the dogfood DB's 4 VKs with these keys carry empty
-- default content (e.g. guardrails.{pre,post,streamChunk}: [],
-- policyRules.{tools,mcp,urls,models}.deny: [], allow: null). Dropping
-- the keys is a no-op for those rows.
--
-- IMPORTANT (prod data caveat): if a prod VK has non-empty content in
-- any of these fields, this migration WILL drop that content. A
-- separate R3-backfill data-walk script must run BEFORE this migration
-- on any environment with real content. See
-- specs/ai-gateway/governance/routing-policy-scope-cascade.feature L72-87
-- for the backfill contract. The dogfood + the PR-test environments
-- have no non-empty content; prod migration runbook tracks the
-- pre-script requirement separately.
--
-- Forward-only. Down migration would restore the keys but the data is
-- already gone, so it would only reset defaults — meaningless reverse.

UPDATE "VirtualKey"
SET config = (config - 'modelAliases' - 'policyRules' - 'guardrails')::jsonb;
