-- The models a provider trusts to skip Langy's permission checks (ADR-129).
--
-- "langySkipPermissionsModels" holds regular expression sources, one per
-- array entry, matched against the bare model id of the conversation. Null
-- means the provider's registry default applies. A stored list replaces that
-- default rather than extending it.
--
-- IRREVERSIBLE: there is no down migration.
--
-- The schema part reverses with the statement below, run by hand:
--
--   ALTER TABLE "ModelProvider" DROP COLUMN "langySkipPermissionsModels";
--
-- The data part does not. The column is the only record of an operator's
-- custom list, so dropping it returns every provider to the registry default
-- and the operator has to type the list again.

ALTER TABLE "ModelProvider" ADD COLUMN "langySkipPermissionsModels" JSONB;
