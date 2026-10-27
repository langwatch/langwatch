-- A `not_onboarded` seat change names no currency (20261006170511), split out so
-- each migration alters ConnectedSeatChange once.
ALTER TABLE "ConnectedSeatChange" ALTER COLUMN "currency" DROP NOT NULL;
