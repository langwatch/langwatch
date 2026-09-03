-- What a connection does with somebody who signs in through it and is not a
-- member yet: admit | request | refuse (ADR-117 §3).
--
-- NULLABLE WITH NO BACKFILL, on purpose. NULL means nobody has said, and the
-- fold then answers with whatever `allowsJit` already said — so every
-- connection registered before this column existed keeps exactly the
-- behaviour it has today, and replaying any history written before this
-- deploy produces the same row it produced before. Backfilling would be this
-- migration deciding a security posture for customers who were never asked.
ALTER TABLE "SsoConnection" ADD COLUMN "arrivalPolicy" TEXT;
