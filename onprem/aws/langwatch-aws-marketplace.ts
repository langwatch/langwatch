#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { LangWatchAwsMarketplaceStack } from "./lib/langwatch-aws-marketplace-stack";
import { LangEvalsStack } from "./lib/lang-evals-stack";
import { LangWatchNLPStack } from "./lib/langwatch-nlp-stack";

const app = new cdk.App();

// Create the main marketplace stack
const marketplaceStack = new LangWatchAwsMarketplaceStack(
  app,
  "LangWatchAwsMarketplaceStack",
  {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */
    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    // env: { account: '123456789012', region: 'us-east-1' },
    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  }
);

const langEvalsStack = new LangEvalsStack(app, "LangEvalsStack", {
  cluster: marketplaceStack.cluster,
});

const langWatchNLPStack = new LangWatchNLPStack(app, "LangWatchNLPStack", {
  cluster: marketplaceStack.cluster,
});

langEvalsStack.addDependency(marketplaceStack);
langWatchNLPStack.addDependency(marketplaceStack);

app.synth();
