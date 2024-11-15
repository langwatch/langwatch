#! /bin/bash

concurrently \
  "aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=\"langwatch-pg.cfu2ksege2c2.eu-central-1.rds.amazonaws.com\",portNumber=\"5432\",localPortNumber=\"5433\" --profile lw-prod" \
  "aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd  --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=\"master.langwatch-redis-replication-group.ulyeig.euc1.cache.amazonaws.com\",portNumber=\"6379\",localPortNumber=\"6378\"  --profile lw-prod"
