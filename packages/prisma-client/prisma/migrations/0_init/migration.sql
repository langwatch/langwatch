-- CreateEnum
CREATE TYPE "TeamUserRole" AS ENUM ('ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrganizationUserRole" AS ENUM ('ADMIN', 'MEMBER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PIIRedactionLevel" AS ENUM ('STRICT', 'ESSENTIAL');

-- CreateEnum
CREATE TYPE "INVITE_STATUS" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('TRACE_CHECK', 'GUARDRAIL', 'CLUSTERING', 'BATCH_EVALUATION');

-- CreateEnum
CREATE TYPE "CostReferenceType" AS ENUM ('CHECK', 'TRACE', 'PROJECT', 'BATCH');

-- CreateEnum
CREATE TYPE "DatabaseSchema" AS ENUM ('FULL_TRACE', 'LLM_CHAT_CALL', 'STRING_I_O', 'KEY_VALUE', 'ONE_MESSAGE_PER_ROW', 'ONE_LLM_CALL_PER_ROW');

-- CreateEnum
CREATE TYPE "TriggerAction" AS ENUM ('SEND_EMAIL', 'ADD_TO_DATASET', 'SEND_SLACK_MESSAGE');

-- CreateEnum
CREATE TYPE "ExperimentType" AS ENUM ('DSPY', 'BATCH_EVALUATION');

-- CreateEnum
CREATE TYPE "AnnotationScoreDataType" AS ENUM ('CATEGORICAL', 'BOOLEAN', 'LIKERT');

-- CreateEnum
CREATE TYPE "PublicShareResourceTypes" AS ENUM ('TRACE', 'THREAD');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "password" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "TeamUser" (
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "TeamUserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamUser_pkey" PRIMARY KEY ("userId","teamId")
);

-- CreateTable
CREATE TABLE "OrganizationUser" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrganizationUserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("userId","organizationId")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usageSpendingMaxLimit" INTEGER,
    "promoCode" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "firstMessage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "piiRedactionLevel" "PIIRedactionLevel" NOT NULL DEFAULT 'ESSENTIAL',
    "topicClusteringModel" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "expiration" TIMESTAMP(3) NOT NULL,
    "status" "INVITE_STATUS" NOT NULL DEFAULT 'PENDING',
    "organizationId" TEXT NOT NULL,
    "teamIds" TEXT NOT NULL,
    "role" "OrganizationUserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isGuardrail" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "preconditions" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "sample" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costType" "CostType" NOT NULL,
    "costName" TEXT,
    "referenceType" "CostReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extraInfo" JSONB,

    CONSTRAINT "Cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "embeddings_model" TEXT NOT NULL,
    "centroid" JSONB NOT NULL,
    "p95Distance" DOUBLE PRECISION NOT NULL,
    "automaticallyGenerated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "schema" "DatabaseSchema" NOT NULL,
    "columns" TEXT NOT NULL DEFAULT 'input,expected_output',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetRecord" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entry" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomGraph" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "graph" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomGraph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchEvaluation" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "details" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "datasetSlug" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "evaluation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" "TriggerAction" NOT NULL,
    "actionParams" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "lastRunAt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "type" "ExperimentType" NOT NULL,
    "slug" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "isThumbsUp" BOOLEAN NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "scoreOptions" JSONB,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelProvider" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "customKeys" JSONB,
    "deploymentMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerSent" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerSent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationScore" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dataType" "AnnotationScoreDataType" NOT NULL,
    "options" JSONB,

    CONSTRAINT "AnnotationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicShare" (
    "id" TEXT NOT NULL,
    "resourceType" "PublicShareResourceTypes" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "TeamUser_teamId_idx" ON "TeamUser"("teamId");

-- CreateIndex
CREATE INDEX "TeamUser_userId_idx" ON "TeamUser"("userId");

-- CreateIndex
CREATE INDEX "OrganizationUser_organizationId_idx" ON "OrganizationUser"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationUser_userId_idx" ON "OrganizationUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_apiKey_key" ON "Project"("apiKey");

-- CreateIndex
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvite_inviteCode_key" ON "OrganizationInvite"("inviteCode");

-- CreateIndex
CREATE INDEX "OrganizationInvite_organizationId_idx" ON "OrganizationInvite"("organizationId");

-- CreateIndex
CREATE INDEX "Check_projectId_idx" ON "Check"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Check_projectId_slug_key" ON "Check"("projectId", "slug");

-- CreateIndex
CREATE INDEX "Cost_referenceType_referenceId_idx" ON "Cost"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Cost_costType_idx" ON "Cost"("costType");

-- CreateIndex
CREATE INDEX "Cost_projectId_idx" ON "Cost"("projectId");

-- CreateIndex
CREATE INDEX "Topic_parentId_idx" ON "Topic"("parentId");

-- CreateIndex
CREATE INDEX "Topic_projectId_idx" ON "Topic"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_projectId_slug_key" ON "Dataset"("projectId", "slug");

-- CreateIndex
CREATE INDEX "DatasetRecord_datasetId_idx" ON "DatasetRecord"("datasetId");

-- CreateIndex
CREATE INDEX "DatasetRecord_projectId_idx" ON "DatasetRecord"("projectId");

-- CreateIndex
CREATE INDEX "CustomGraph_projectId_idx" ON "CustomGraph"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomGraph_id_key" ON "CustomGraph"("id");

-- CreateIndex
CREATE INDEX "BatchEvaluation_projectId_idx" ON "BatchEvaluation"("projectId");

-- CreateIndex
CREATE INDEX "BatchEvaluation_datasetId_idx" ON "BatchEvaluation"("datasetId");

-- CreateIndex
CREATE INDEX "BatchEvaluation_experimentId_idx" ON "BatchEvaluation"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchEvaluation_id_key" ON "BatchEvaluation"("id");

-- CreateIndex
CREATE INDEX "Trigger_projectId_idx" ON "Trigger"("projectId");

-- CreateIndex
CREATE INDEX "Experiment_projectId_idx" ON "Experiment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_projectId_slug_key" ON "Experiment"("projectId", "slug");

-- CreateIndex
CREATE INDEX "Annotation_projectId_idx" ON "Annotation"("projectId");

-- CreateIndex
CREATE INDEX "Annotation_traceId_idx" ON "Annotation"("traceId");

-- CreateIndex
CREATE INDEX "Annotation_userId_idx" ON "Annotation"("userId");

-- CreateIndex
CREATE INDEX "ModelProvider_projectId_idx" ON "ModelProvider"("projectId");

-- CreateIndex
CREATE INDEX "TriggerSent_triggerId_idx" ON "TriggerSent"("triggerId");

-- CreateIndex
CREATE INDEX "TriggerSent_projectId_idx" ON "TriggerSent"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerSent_triggerId_traceId_key" ON "TriggerSent"("triggerId", "traceId");

-- CreateIndex
CREATE INDEX "AnnotationScore_projectId_idx" ON "AnnotationScore"("projectId");

-- CreateIndex
CREATE INDEX "PublicShare_userId_idx" ON "PublicShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicShare_projectId_resourceType_resourceId_key" ON "PublicShare"("projectId", "resourceType", "resourceId");

