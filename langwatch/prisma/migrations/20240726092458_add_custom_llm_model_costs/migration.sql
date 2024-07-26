-- CreateTable
CREATE TABLE "CustomLLMModelCost" (
    "projectId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "regex" TEXT NOT NULL,
    "inputCostPerToken" DOUBLE PRECISION,
    "outputCostPerToken" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomLLMModelCost_pkey" PRIMARY KEY ("projectId","model")
);
