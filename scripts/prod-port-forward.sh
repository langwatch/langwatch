#! /bin/bash

node_modules/.bin/concurrently \
  "kubectl port-forward svc/db-tunnel 5433:5432" \
  "kubectl port-forward svc/db-tunnel 6378:6379"
