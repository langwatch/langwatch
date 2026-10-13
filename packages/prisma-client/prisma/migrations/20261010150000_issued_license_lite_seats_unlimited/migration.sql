-- Unlimited lite seats get their own flag, so the seat count never carries a stand-in number
-- that overflows the column (a purchased GROWTH licence was never recorded). Null seats now mean
-- "not stated" or, with the flag, "unlimited"; releases still serving write a number as before.
ALTER TABLE "IssuedLicense" ADD COLUMN IF NOT EXISTS "liteSeatsUnlimited" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "maxMembersLite" DROP NOT NULL;
