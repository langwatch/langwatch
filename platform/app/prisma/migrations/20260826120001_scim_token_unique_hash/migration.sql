-- A SCIM bearer token identifies ONE organization, and the database now says so.
--
-- `hashedToken` is the only thing the SCIM boundary has to go on: the caller
-- presents a token and nothing else, so the lookup is keyed on this column
-- alone. That was safe while every token was 32 bytes from `crypto.randomBytes`
-- and a collision was impossible. It stopped being safe when an administrator
-- could supply a value they already hold: two organizations can choose the same
-- string, `findFirst` answers with whichever row the planner reaches first, and
-- one customer's directory provisions and deletes another customer's people.
--
-- Safe to run: every existing row was minted from 32 random bytes, so no two
-- can collide and the index build cannot fail on existing data. The table holds
-- roughly one row per connection, so the lock this takes is measured in
-- milliseconds - unlike an index on `Session`, this one does not need a
-- maintenance window.
--
-- `hashScheme` records how the digest was derived so the two schemes can
-- coexist. Existing rows are bare SHA-256, which is right for 32 random bytes;
-- new rows are HMAC-SHA256 keyed on the deployment's own secret, so a database
-- dump of administrator-chosen tokens is inert rather than a wordlist away from
-- live credentials.
--
-- To roll back, uncomment and run manually.
-- DROP INDEX "ScimToken_hashedToken_key";
-- ALTER TABLE "ScimToken" DROP COLUMN "hashScheme";
-- CREATE INDEX "ScimToken_hashedToken_idx" ON "ScimToken"("hashedToken");

ALTER TABLE "ScimToken" ADD COLUMN "hashScheme" TEXT NOT NULL DEFAULT 'sha256';

DROP INDEX IF EXISTS "ScimToken_hashedToken_idx";

CREATE UNIQUE INDEX "ScimToken_hashedToken_key" ON "ScimToken"("hashedToken");
