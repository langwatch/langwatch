---
name: helm-security-scan
description: "Security posture check of the LangWatch Helm chart: image pinning, security contexts, RBAC, secrets, network policies, pod security standards."
user-invocable: true
argument-hint: "[--fix] [--severity critical|high|medium|low|all]"
---

# Helm Security Scan

Security-focused audit of the Helm chart at `charts/langwatch/`. Reads all chart files and reports security findings with severity levels.

## Step 1: Read all chart files

Read these files before starting the scan:

- `charts/langwatch/values.yaml`
- `charts/langwatch/templates/_helpers.tpl`
- All files under `charts/langwatch/templates/` (recursively)
- `charts/langwatch/Chart.yaml`

## Step 2: Parse arguments

- `--fix` -- After reporting, offer to fix each finding (ask before each fix)
- `--severity <level>` -- Only show findings at this level or above (default: `all`)

Severity levels (highest to lowest): CRITICAL, HIGH, MEDIUM, LOW, INFO

## Step 3: Run security checks

### SEC-01: Image pinning (HIGH)

Check `values.yaml` `images:` section and all templates for image references:

- **CRITICAL**: Any image using `:latest` tag (mutable, can change between deploys)
- **HIGH**: Any image using a non-digest, non-semver tag
- **MEDIUM**: Images using semver tags without digest pinning (acceptable but not ideal)
- **INFO**: Images using digest-pinned references (good)

Check both:
- `values.yaml` image definitions (app, langwatch_nlp, langevals, cronjobs)
- Hardcoded images in templates (init containers like `curlimages/curl:latest`)

### SEC-02: Pod security contexts (HIGH)

For each pod template in every Deployment and CronJob, verify:

- **CRITICAL**: `runAsNonRoot: true` is set (either directly or via global fallback)
- **HIGH**: `runAsUser` is set to a non-zero value
- **HIGH**: `fsGroup` is set

Check the global defaults in `values.yaml` under `global.podSecurityContext` and verify they are properly inherited. Flag any template that does NOT use `coalesce` with the global fallback (meaning local override would completely skip security context instead of falling back to global).

### SEC-03: Container security contexts (CRITICAL)

For each container in every Deployment and CronJob, verify:

- **CRITICAL**: `allowPrivilegeEscalation: false`
- **CRITICAL**: `capabilities.drop` includes `ALL`
- **HIGH**: `readOnlyRootFilesystem: true`
- **MEDIUM**: `runAsNonRoot: true` at container level (redundant with pod level but defense-in-depth)

Check:
- Global defaults in `values.yaml` under `global.containerSecurityContext`
- That every container template applies security context (either directly or via coalesce)
- Init containers -- do they have security context set?
- CronJob containers -- do they have individual container security context?

### SEC-04: Network policies (MEDIUM)

Check for the presence of NetworkPolicy resources in the templates directory:

- **MEDIUM**: No NetworkPolicy templates found (services are network-open within the cluster)
- **INFO**: If present, verify they restrict ingress/egress appropriately

### SEC-05: RBAC configuration (MEDIUM)

Check for:

- **MEDIUM**: No ServiceAccount, Role, RoleBinding, or ClusterRole templates (pods run with default SA)
- **LOW**: If ServiceAccounts exist, check `automountServiceAccountToken: false` is set on pods that do not need API access

### SEC-06: Secret exposure (HIGH)

Check `values.yaml` for secrets that have non-empty default values (plain text secrets shipped in defaults):

- **CRITICAL**: Any password, API key, or encryption key with a non-empty default `value:`
- **HIGH**: Secret values that could be set via `value:` field without secretKeyRef alternative
- **MEDIUM**: Autogen secrets that use weak randomness (check `_helpers.tpl` or `secrets.yaml` for `randAlphaNum` length)

Also check:
- Are secrets mounted as env vars (less secure) vs volume-mounted files?
- Are there any secrets in ConfigMaps instead of Secret resources?

### SEC-07: Probe coverage (MEDIUM)

For each Deployment, check health probe configuration:

- **HIGH**: No readinessProbe (traffic routed to unready pods)
- **HIGH**: No livenessProbe (hung processes not restarted)
- **MEDIUM**: No startupProbe (slow-starting apps may be killed by liveness probe)
- **INFO**: Probes present with appropriate timeouts

### SEC-08: Pod security standards compliance (HIGH)

Check compliance with Kubernetes Pod Security Standards (Restricted profile):

- **HIGH**: Any container that could run as root (missing `runAsNonRoot`)
- **HIGH**: Any container that allows privilege escalation
- **HIGH**: Capabilities not dropped
- **MEDIUM**: Host network/PID/IPC namespaces used
- **MEDIUM**: HostPath volumes used
- **LOW**: Seccomp profile not set (RuntimeDefault recommended)

### SEC-09: Resource limits (MEDIUM)

- **MEDIUM**: Any container without `resources.limits` (can consume unbounded resources)
- **LOW**: Any container without `resources.requests` (scheduler cannot make informed decisions)
- **INFO**: Init containers without resource limits (transient, lower risk)

### SEC-10: Ingress TLS (MEDIUM)

If ingress is enabled:

- **HIGH**: Ingress configured without TLS (plain HTTP)
- **MEDIUM**: No `force-ssl-redirect` annotation when TLS is configured
- **INFO**: TLS properly configured

Check `values.yaml` default ingress configuration.

## Output format

Use severity-colored headers and group by severity:

```text
## Helm Security Scan: charts/langwatch/

### CRITICAL (N findings)

#### SEC-03: Container security contexts
- workers/deployment.yaml -- init container `wait-for-opensearch` uses `curlimages/curl:latest` with no security context

### HIGH (N findings)

#### SEC-01: Image pinning
- values.yaml:896 -- `cronjobs.image.tag: latest` (mutable tag)
- app/deployment.yaml:94 -- `curlimages/curl:latest` hardcoded in init container
- workers/deployment.yaml:74 -- `curlimages/curl:latest` hardcoded in init container

#### SEC-02: Pod security contexts
- cronjobs/cronjobs.yaml -- does not use `coalesce` for pod security context (no per-job override possible)

...

### MEDIUM (N findings)
...

### LOW (N findings)
...

### INFO (N findings)
...

## Summary
| Severity | Count |
|----------|-------|
| CRITICAL | N     |
| HIGH     | N     |
| MEDIUM   | N     |
| LOW      | N     |
| INFO     | N     |

Risk assessment: [CRITICAL/HIGH/MODERATE/LOW] -- brief explanation
```

## Remediation guidance

For each finding at HIGH or above, include a brief remediation suggestion. For example:

- "Pin `curlimages/curl` to a specific semver tag like `8.7.1` instead of `latest`"
- "Add `securityContext` to the init container with the same restrictions as the main container"
- "Create a NetworkPolicy template that restricts ingress to the app service from the ingress controller only"

If `--fix` was specified, after the report ask the user which findings to fix, then apply the changes to the chart files.
