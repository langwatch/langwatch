---
name: helm-review
description: "Lint and audit the LangWatch Helm chart for template bugs, missing probes, DRY violations, and configuration issues."
user-invocable: true
argument-hint: "[--fix] [--section app|workers|langevals|nlp|cronjobs|all]"
---

# Helm Review

Lint and audit the Helm chart at `charts/langwatch/` for common issues. Read every template file and values.yaml, then report findings.

## What to review

Parse `$ARGUMENTS` for optional flags:
- `--fix` -- After reporting, offer to fix each issue (ask before each fix)
- `--section <name>` -- Only review a specific section (default: `all`)

## Step 1: Read all chart files

Read these files before starting the review:

- `charts/langwatch/values.yaml`
- `charts/langwatch/templates/_helpers.tpl`
- All files in `charts/langwatch/templates/app/`
- All files in `charts/langwatch/templates/workers/`
- All files in `charts/langwatch/templates/langevals/`
- All files in `charts/langwatch/templates/langwatch_nlp/`
- All files in `charts/langwatch/templates/cronjobs/`
- `charts/langwatch/templates/ingress.yaml`
- `charts/langwatch/templates/prometheus.yaml`
- `charts/langwatch/Chart.yaml`

## Step 2: Run checks

For each check below, report **PASS** if no issues found, or **FAIL** with every violation listed as `file:line -- description`.

### 1. Template variable reference bugs

Check that every `.Values.X.Y` reference in a template for service X actually references service X, not a different service. Known pattern: copy-pasting a template from one service and forgetting to rename all value references.

Specifically check:
- `langevals/deployment.yaml` -- should NOT reference `.Values.langwatch_nlp.*` or `.Values.deployment.*`
- `langwatch_nlp/deployment.yaml` -- should NOT reference `.Values.langevals.*` or `.Values.app.*`
- `workers/deployment.yaml` -- should NOT reference `.Values.app.*` except for shared config that the workers intentionally inherit (like `app.nodeEnv`, `app.http`, `app.features`, `app.upstreams`, `app.evaluators`, `app.credentialsEncryptionKey`, `app.telemetry`, and `app.service.port` for prometheus annotations)
- Every service's revisionHistoryLimit should reference `.Values.{service}.deployment.revisionHistoryLimit`, not `.Values.deployment.revisionHistoryLimit` or another service's config
- Pod labels in templates should reference `.Values.{service}.pod.labels`, not `.Values.{service}.labels`

### 2. Missing health probes

Check all Deployment templates for `livenessProbe`, `readinessProbe`, and `startupProbe` on the main container. Flag any deployment that has zero probes defined.

### 3. Unpinned image tags

Check both `values.yaml` and templates for:
- Image tags set to `latest` (mutable, non-reproducible)
- Image tags that are not semver-pinned
- Init container images in templates that hardcode `:latest` (e.g., `curlimages/curl:latest`)

### 4. Secret validation coverage

Read `_helpers.tpl` and check `langwatch.validateSecrets`. Verify that every secret/secretKeyRef pair defined in `values.yaml` has a corresponding validation check. Flag any secret configuration that can be misconfigured without being caught by validation.

### 5. DRY violations between app and workers

Compare `templates/app/deployment.yaml` and `templates/workers/deployment.yaml`. Identify blocks of env vars or configuration that are duplicated between them. Count the duplicated lines and note which sections are repeated.

Focus on:
- PostgreSQL connection env vars
- Redis connection env vars
- ClickHouse connection env vars
- Credentials encryption key
- Evaluator env vars
- Telemetry env vars

### 6. Security context completeness

For each deployment, check:
- Pod-level securityContext uses `coalesce` with global fallback
- Container-level securityContext uses `coalesce` with global fallback
- CronJobs: check if they use `coalesce` or only reference global (no per-service override)

### 7. Resource limits defined

Check that every container (including init containers and sidecar containers defined in templates) has `resources:` with both `requests` and `limits`. Flag any container without resource configuration.

### 8. PDB configuration

Check that:
- Every deployment has a corresponding PDB template
- Workers PDB is guarded by `.Values.workers.enabled`
- PDB templates use the correct selector labels matching their deployment
- PDB values allow configuration (minAvailable/maxUnavailable)

### 9. Labels consistency

Check that all resources follow the labeling convention:
- `app.kubernetes.io/name` is set consistently
- `app.kubernetes.io/instance` matches across deployment and service/PDB selectors
- `langwatch.labels` helper is included on metadata

### 10. Ingress service reference

Check that the ingress template references the app service using the release name prefix (not a hardcoded name). Check `values.yaml` default ingress host config for the same issue.

## Output format

```text
## Helm Chart Review: charts/langwatch/

### 1. Template variable reference bugs -- FAIL
- langevals/deployment.yaml:14 -- annotations reference `.Values.langwatch_nlp.deployment.annotations` instead of `.Values.langevals.deployment.annotations`
- langevals/deployment.yaml:21 -- strategy references `.Values.langwatch_nlp.deployment.strategy`

### 2. Missing health probes -- FAIL
- app/deployment.yaml -- no liveness/readiness/startup probes
- langevals/deployment.yaml -- no liveness/readiness/startup probes

### 3. Unpinned image tags -- FAIL
- app/deployment.yaml:94 -- `curlimages/curl:latest` in wait-for-opensearch init container

...

## Summary
- PASS: 3/10
- FAIL: 7/10
- Total issues: N
```

If `--fix` was specified, after the report ask the user which issues to fix, then apply the changes.
