-- AlterTable
ALTER TABLE "SsoConnection" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "SsoConnection" ALTER COLUMN "clientSecretEnc" DROP NOT NULL;
