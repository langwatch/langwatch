ALTER TABLE "OrganizationUser"
ADD COLUMN "membershipStamp" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
