-- IRREVERSIBLE: a data fix. The removed trailing slash is not recorded, and
-- the form without it is the one Entra ID tokens carry.
-- @tenancy: a data fix over every SSO provider row, not a tenant query.
-- Entra ID signs v2 tokens with `iss` = `https://login.microsoftonline.com/<tenant>/v2.0`,
-- no trailing slash, and the engine compares it to the stored issuer exactly.
-- New rows are written in that form (`canonicalEntraIssuer`); this rewrites
-- rows stored with a trailing slash, so those connections sign in without
-- being registered again.
UPDATE "SsoProvider"
SET "issuer" = regexp_replace("issuer", '/+$', '')
WHERE "oidcConfig" IS NOT NULL
  AND "issuer" ~ '^https://login\.(microsoftonline\.com|microsoftonline\.us|partner\.microsoftonline\.cn|chinacloudapi\.cn|windows\.net)/[^/]+/v2\.0/+$';
