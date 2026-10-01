-- Expand only. Marks a key LangWatch minted for itself, so hiding and the system actor
-- no longer read the name. Existing rows stay false: a customer key under a newly
-- reserved name stays the customer's. The previous image never names the column.
ALTER TABLE "ApiKey" ADD COLUMN "isSystemManaged" BOOLEAN NOT NULL DEFAULT false;
