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

