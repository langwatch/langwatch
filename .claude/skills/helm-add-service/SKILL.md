---
name: helm-add-service
description: "Scaffold a new service into the LangWatch Helm chart: deployment, service, PDB, values, and image config."
user-invocable: true
argument-hint: "<service-name> [--image repo:tag] [--port N] [--cpu-request Xm] [--mem-request XGi]"
---

# Helm Add Service

Scaffold a new service into the Helm chart at `charts/langwatch/`.

## Step 1: Gather parameters

Parse `$ARGUMENTS` for the service name and optional flags. If the service name is missing, ask the user. Use these defaults for anything not provided:

| Parameter | Default |
|-----------|---------|
| `--image` | ask the user (repository:tag) |
| `--port` | ask the user |
| `--cpu-request` | `250m` |
| `--cpu-limit` | `1000m` |
| `--mem-request` | `2Gi` |
| `--mem-limit` | `4Gi` |
| `--upstream` | (optional) if the app deployment needs an env var pointing at this service |

## Step 2: Read existing chart patterns

Before generating anything, read these files to match the exact conventions:

1. `charts/langwatch/values.yaml` -- for the service section shape and `images:` block
2. `charts/langwatch/templates/langevals/deployment.yaml` -- canonical deployment template (simpler than app)
3. `charts/langwatch/templates/langevals/service.yaml` -- canonical service template
4. `charts/langwatch/templates/langevals/pdb.yaml` -- canonical PDB template
5. `charts/langwatch/templates/_helpers.tpl` -- shared helpers used in templates

## Step 3: Create the template directory

Create `charts/langwatch/templates/{service-name}/` with three files.

### `deployment.yaml`

Follow the langevals deployment pattern exactly:

- Deployment name: `{{ .Release.Name }}-{service-name}`
- Labels: `app.kubernetes.io/name: {{ .Release.Name }}-{service-name}` + `app.kubernetes.io/instance` + `langwatch.labels` include + service-specific `.Values.{service_name}.labels`
- Annotations from `.Values.{service_name}.deployment.annotations` (NOT from a different service -- avoid the langevals copy-paste bug that references `langwatch_nlp`)
- Strategy from `.Values.{service_name}.deployment.strategy`
- RevisionHistoryLimit from `.Values.{service_name}.deployment.revisionHistoryLimit` (NOT from `.Values.deployment.revisionHistoryLimit`)
- Pod template labels: use `.Values.{service_name}.pod.labels` (NOT `.Values.{service_name}.labels`)
- Pod annotations: check `.Values.{service_name}.podAnnotations` then fall back to `.Values.global.podAnnotations`
- Pod security context: `coalesce .Values.{service_name}.podSecurityContext .Values.global.podSecurityContext`
- Scheduling (all four): `coalesce` local then `global.scheduling.*` for nodeSelector, tolerations, affinity
- Init containers: `extraInitContainers`
- Extra containers: `extraContainers`
- Main container:
  - Container security context: `coalesce .Values.{service_name}.containerSecurityContext .Values.global.containerSecurityContext`
  - Image: `{{ .Values.images.{service_name}.repository }}:{{ .Values.images.{service_name}.tag }}`
  - Pull policy: from `images.{service_name}.pullPolicy`
  - Port: named `http`, from `.Values.{service_name}.service.port`
  - Env: include `extraEnvs`, plus any service-specific env vars
  - Lifecycle: from `extra{ServiceName}Lifecycle`
  - Resources: from `.Values.{service_name}.resources`
  - Volume mounts: `extra{ServiceName}VolumeMounts` + `/tmp` emptyDir
- Volumes: `extraVolumes` + `tmp-dir` emptyDir

### `service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}-{service-name}
  labels:
    app.kubernetes.io/name: {{ .Release.Name }}-{service-name}
    app.kubernetes.io/instance: {{ .Release.Name }}
spec:
  type: {{ .Values.{service_name}.service.type }}
  ports:
    - port: {{ .Values.{service_name}.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    app.kubernetes.io/name: {{ .Release.Name }}-{service-name}
    app.kubernetes.io/instance: {{ .Release.Name }}
```

### `pdb.yaml`

```yaml
{{- with .Values.{service_name}.podDisruptionBudget }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ $.Release.Name }}-{service-name}-pdb
  labels:
    app.kubernetes.io/name: {{ $.Release.Name }}-{service-name}
    app.kubernetes.io/instance: {{ $.Release.Name }}
    {{- include "langwatch.labels" $ | nindent 4 }}
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ $.Release.Name }}-{service-name}
      app.kubernetes.io/instance: {{ $.Release.Name }}
  {{- toYaml . | nindent 2 }}
{{- end }}
```

## Step 4: Add the image to `values.yaml`

Add an entry under the `images:` section following the existing pattern:

```yaml
  {service_name}:
    repository: {image-repository}
    tag: {image-tag}
    pullPolicy: IfNotPresent
```

Place it after the last image entry (currently `langevals`).

## Step 5: Add the service section to `values.yaml`

Add a new top-level section following the pattern of `langevals` or `langwatch_nlp`. Include all of these:

```yaml
{service_name}:
  replicaCount: 1
  service: { type: ClusterIP, port: {port} }
  resources:
    requests: { cpu: {cpu-request}, memory: {mem-request} }
    limits: { cpu: {cpu-limit}, memory: {mem-limit} }

  # Kubernetes pass-through
  podSecurityContext: {}
  containerSecurityContext: {}
  podDisruptionBudget: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}
  topologySpreadConstraints: []
  pod:
    annotations: {}
    labels: {}
  deployment:
    annotations: {}
    labels: {}
    strategy: {}
  revisionHistoryLimit: 10
  extraEnvs: []
  extraContainers: []
  extraVolumes: []
  extraInitContainers: []
  extra{ServiceName}Lifecycle: {}
  extra{ServiceName}VolumeMounts: []
```

## Step 6: Wire upstream reference (if applicable)

If `--upstream` is specified, add an env var in the app deployment (`templates/app/deployment.yaml`) pointing at the new service, following the pattern of `LANGWATCH_NLP_SERVICE` or `LANGEVALS_ENDPOINT`:

```yaml
- name: {UPSTREAM_ENV_NAME}
  value: {{ .Values.app.upstreams.{service_name}.scheme | default "http" }}://{{ .Values.app.upstreams.{service_name}.name | default (printf "%s-{service-name}" .Release.Name) }}:{{ .Values.app.upstreams.{service_name}.port | default {port} }}
```

And add the corresponding `upstreams` entry in `values.yaml` under `app.upstreams`.

## Step 7: Verify

After generating all files:

1. Check that every `.Values.{service_name}.*` reference in templates has a corresponding key in `values.yaml`
2. Check that the deployment annotations/strategy/labels do NOT reference a different service's values (this is a known copy-paste bug in the existing `langevals` templates)
3. Confirm the image key in `values.yaml` matches what the deployment template references

## Known bugs to avoid

These are real bugs in the existing chart that you MUST NOT replicate:

- **langevals/deployment.yaml line 14**: annotations reference `.Values.langwatch_nlp.deployment.annotations` instead of `.Values.langevals.deployment.annotations`
- **langevals/deployment.yaml line 21**: strategy references `.Values.langwatch_nlp.deployment.strategy` instead of `.Values.langevals.deployment.strategy`
- **langevals/deployment.yaml line 24**: revisionHistoryLimit references `.Values.deployment.revisionHistoryLimit` (missing service prefix entirely)
- **langevals/deployment.yaml line 36**: pod labels reference `.Values.langevals.labels` instead of `.Values.langevals.pod.labels`

Always use the correct service name in all value references.
