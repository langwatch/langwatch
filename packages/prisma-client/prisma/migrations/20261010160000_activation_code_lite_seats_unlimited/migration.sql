-- An activation code's unlimited lite seats get their own flag, as the licence registry's did
-- (20261010150000), so the seat count never carries a stand-in number that overflows the column.
-- The default of 0 stays for releases still serving, which insert without naming the column.
ALTER TABLE "ActivationCode" ADD COLUMN IF NOT EXISTS "liteSeatsUnlimited" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "maxMembersLite" DROP NOT NULL;
