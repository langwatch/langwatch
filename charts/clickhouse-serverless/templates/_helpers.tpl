{{/* Chart label */}}
{{- define "clickhouse-serverless.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fullname: <release>-clickhouse, truncated to leave room for -keeper-headless suffix */}}
{{- define "clickhouse-serverless.fullname" -}}
{{- printf "%s-clickhouse" (.Release.Name | trunc 36 | trimSuffix "-") -}}
{{- end -}}

{{/* Common labels (does NOT include selectorLabels — add those separately per resource) */}}
{{- define "clickhouse-serverless.labels" -}}
helm.sh/chart: {{ include "clickhouse-serverless.chart" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels */}}
{{- define "clickhouse-serverless.selectorLabels" -}}
app.kubernetes.io/name: {{ include "clickhouse-serverless.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Password secret name (supports tpl expressions in existingSecret for parent-chart ownership) */}}
{{- define "clickhouse-serverless.secretName" -}}
  {{- if .Values.auth.existingSecret -}}
    {{- tpl .Values.auth.existingSecret . -}}
  {{- else -}}
    {{- include "clickhouse-serverless.fullname" . -}}
  {{- end -}}
{{- end -}}

{{/* ServiceAccount name */}}
{{- define "clickhouse-serverless.serviceAccountName" -}}
  {{- if .Values.serviceAccount.name -}}
    {{- .Values.serviceAccount.name -}}
  {{- else -}}
    {{- include "clickhouse-serverless.fullname" . -}}
  {{- end -}}
{{- end -}}

{{/* Keeper selector labels */}}
{{- define "clickhouse-serverless.keeperSelectorLabels" -}}
app.kubernetes.io/name: {{ include "clickhouse-serverless.fullname" . }}-keeper
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Keeper labels (selector + component + common) */}}
{{- define "clickhouse-serverless.keeperLabels" -}}
{{ include "clickhouse-serverless.keeperSelectorLabels" . }}
app.kubernetes.io/component: keeper
{{ include "clickhouse-serverless.labels" . }}
{{- end -}}

{{/* Comma-separated keeper node hostnames */}}
{{- define "clickhouse-serverless.keeperNodes" -}}
{{- $fullname := include "clickhouse-serverless.fullname" . -}}
{{- $replicas := .Values.replicas | int -}}
{{- $nodes := list -}}
{{- range $i := until $replicas -}}
  {{- $nodes = append $nodes (printf "%s-keeper-%d.%s-keeper-headless.%s.svc.cluster.local" $fullname $i $fullname $.Release.Namespace) -}}
{{- end -}}
{{- join "," $nodes -}}
{{- end -}}

{{/* Comma-separated data node hostnames */}}
{{- define "clickhouse-serverless.dataNodes" -}}
{{- $fullname := include "clickhouse-serverless.fullname" . -}}
{{- $replicas := .Values.replicas | int -}}
{{- $nodes := list -}}
{{- range $i := until $replicas -}}
  {{- $nodes = append $nodes (printf "%s-%d.%s-headless.%s.svc.cluster.local" $fullname $i $fullname $.Release.Namespace) -}}
{{- end -}}
{{- join "," $nodes -}}
{{- end -}}

{{/* Validation: fail early on invalid configuration */}}
{{- define "clickhouse-serverless.validate" -}}
  {{- include "clickhouse-serverless.validateAuth" . }}
  {{- if and (or .Values.cold.enabled .Values.backup.enabled) (not .Values.objectStorage.bucket) }}
    {{- fail "objectStorage.bucket is required when cold.enabled or backup.enabled is true" }}
  {{- end }}
  {{- if and (or .Values.cold.enabled .Values.backup.enabled) (not .Values.objectStorage.region) (not .Values.objectStorage.endpoint) }}
    {{- fail "objectStorage.region or objectStorage.endpoint is required when cold.enabled or backup.enabled is true" }}
  {{- end }}
  {{- if and (gt (int .Values.replicas) 1) (eq (mod (int .Values.replicas) 2) 0) }}
    {{- fail "replicas must be odd when greater than 1 (required for Keeper raft quorum)" }}
  {{- end }}
  {{- include "clickhouse-serverless.validateTransition" . }}
{{- end -}}

{{/* Transition guard: refuse to scale an EXISTING single-node release into a
     replicated topology.

     Measured on kind against langwatch/clickhouse-serverless (issue #1168,
     P1.7), upgrading a release from replicas=1 to replicas=3 leaves the
     existing tables as plain MergeTree on pod-0 only. The new replicas come up
     with empty data directories: per-pod `SELECT count()` returned the full
     count on pod-0 and `Code: 81 ... Database up does not exist
     (UNKNOWN_DATABASE)` on pods 1 and 2, and five identical distributed
     `SELECT count()` calls returned the full count four times and
     UNKNOWN_DATABASE once. A user issuing the same query twice gets different
     answers, with no error to tell them the topology changed underneath. The
     five SQL-defined access-entity classes are likewise not migrated. There is
     no migration code on this path, so the chart refuses it rather than letting
     it half-succeed.

     LOOKUP SOURCE. The current replica count is read from the live
     StatefulSet's spec.replicas, not from the release's recorded values: Helm
     does not expose the previous release's values to templates, and
     spec.replicas is the topology that actually exists — it stays correct even
     if someone scaled the StatefulSet outside Helm.

     WHEN THE GUARD IS INERT, DECLARED. `lookup` returns nil whenever the
     renderer has no cluster access. Under ArgoCD the repo-server renders
     without a cluster connection (see secret.yaml's HISTORY note — the same
     nil-lookup behaviour caused the credential-rotation postmortem), and
     `helm template` behaves the same way. In those contexts this guard is
     SILENTLY INERT and a 1 -> 3 transition will not be blocked. That is
     accepted deliberately: a lookup-based guard cannot do better, and failing
     closed on nil would break every ArgoCD sync and every `helm template`,
     including legitimate ones. The guard is a safety net for the interactive
     `helm upgrade` path, not a security boundary.

     It is also scoped to upgrades only (.Release.IsUpgrade), so a fresh
     install at any replica count is never blocked — including a fresh install
     into a namespace where an unrelated StatefulSet of the same name lingers. */}}
{{- define "clickhouse-serverless.validateTransition" -}}
  {{- if .Release.IsUpgrade }}
    {{- $desired := int .Values.replicas }}
    {{- if gt $desired 1 }}
      {{- $sts := lookup "apps/v1" "StatefulSet" .Release.Namespace (include "clickhouse-serverless.fullname" .) }}
      {{- if $sts }}
        {{- if eq (int $sts.spec.replicas) 1 }}
          {{- fail (printf "unsupported transition: this release is running replicas=1 and this upgrade requests replicas=%d. Scaling an existing single-node ClickHouse release into a replicated topology is not supported: existing tables stay plain MergeTree on pod-0, so the new replicas start with empty data directories and identical distributed queries return different answers depending on which replica they land on. SQL-defined access entities (users, grants, row policies, settings profiles, named collections) are not migrated either. To run replicated, install a NEW release at replicas=%d and migrate data explicitly; or set replicas=1 to leave this release unchanged." $desired $desired) }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end -}}

{{/* Auth wiring fail-fast: hard-stop the render when neither path to a
     credentials Secret is configured. Either autogen.enabled=true (the
     chart materialises the Secret via lookup-or-rand) or
     auth.existingSecret points at an operator-owned Secret. With both
     unset the StatefulSet would mount a Secret name that never gets
     created and the ClickHouse pods would crashloop with
     CreateContainerConfigError. Catch it at chart-render time instead. */}}
{{- define "clickhouse-serverless.validateAuth" -}}
  {{- if and (not .Values.autogen.enabled) (empty .Values.auth.existingSecret) }}
    {{- fail "clickhouse-serverless: no credentials Secret configured. Either set autogen.enabled=true (chart materialises the Secret on first install via lookup-or-rand) OR pre-create a Secret with `password` (and `clusterSecret` when replicas>1) and set auth.existingSecret to its name." -}}
  {{- end }}
{{- end -}}

{{/* Password secret key (uses auth.secretKeys.passwordKey for both the
     autogen and existing-secret paths so the StatefulSet env mapping
     and the rendered Secret data key always agree). */}}
{{- define "clickhouse-serverless.secretKey" -}}
{{- default "password" .Values.auth.secretKeys.passwordKey -}}
{{- end -}}

{{/* Cluster secret key (same shape as secretKey above). */}}
{{- define "clickhouse-serverless.clusterSecretKey" -}}
{{- default "clusterSecret" .Values.auth.secretKeys.clusterSecretKey -}}
{{- end -}}

