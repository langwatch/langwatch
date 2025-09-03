{{/* Our Label */}}
{{- define "langwatch.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common label set */}}
{{- define "langwatch.labels" -}}
helm.sh/chart: {{ include "langwatch.chart" . }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: langwatch
{{- end -}}

{{/* Selector labels (must match .spec.selector and pod labels) */}}
{{- define "langwatch.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* ==== pgSQL region ==== */}}

{{/* Must get PostgreSQL hostname */}}
{{- define "langwatch.postgresql.hostname" -}}
{{- if eq .Values.postgresql.source "built-in" -}}
{{ printf "%s-postgresql" .Release.Name }}
{{- else -}}
{{- required "postgresql.external.host is required when postgresql.source != built-in" .Values.postgresql.external.host -}}
{{- end -}}
{{- end -}}

{{/* Get PostgreSQL port (or default) */}}
{{- define "langwatch.postgresql.port" -}}
{{- if eq .Values.postgresql.source "built-in" -}}
"5432"
{{- else -}}
{{ (.Values.postgresql.external.port | default 5432) | toString | quote }}
{{- end -}}
{{- end -}}

{{/* Create pgSQL env-var set */}}
{{- define "langwatch.postgresqlEnvSet" -}}
{{- /* choose key: postgres -> postgres-password; else password; allow override */ -}}
{{- $builtInPassKey := ( default ( ternary "postgres-password" "password" ( eq (default "" .Values.postgresql.auth.username) "postgres" ) ) .Values.postgresql.auth.secretKeys.builtInUserPasswordKey ) -}}

- name: DATABASE_HOST
  value: {{ include "langwatch.postgresql.hostname" . | quote }}
- name: DATABASE_PORT
  value: {{ include "langwatch.postgresql.port" . }}
- name: DATABASE_USERNAME
  {{- if .Values.postgresql.auth.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecret | quote }}
      key: {{ (.Values.postgresql.auth.secretKeys.usernameKey | default "username") | quote }}
  {{- else if .Values.secrets.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: {{ (.Values.postgresql.auth.secretKeys.usernameKey | default "username") | quote }}
  {{- else }}
  value: {{ required "postgresql.auth.username is required if not using secrets" .Values.postgresql.auth.username | quote }}
  {{- end }}
- name: DATABASE_NAME
  {{- if .Values.postgresql.auth.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecret | quote }}
      key: {{ (.Values.postgresql.auth.secretKeys.databaseKey | default "database") | quote }}
  {{- else if .Values.secrets.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: {{ (.Values.postgresql.auth.secretKeys.databaseKey | default "database") | quote }}
  {{- else }}
  value: {{ required "postgresql.auth.database is required if not using secrets" .Values.postgresql.auth.database | quote }}
  {{- end }}
- name: DATABASE_PASSWORD
  {{- if eq .Values.postgresql.source "built-in" }}
  value: {{ .Values.postgresql.auth.password | quote }}
  {{- else if .Values.postgresql.auth.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecret | quote }}
      key: {{ (.Values.postgresql.auth.secretKeys.userPasswordKey | default "password") | quote }}
  {{- else if .Values.secrets.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: {{ (.Values.postgresql.auth.secretKeys.userPasswordKey | default "password") | quote }}
  {{- else if .Values.postgresql.external.password }}
  value: {{ .Values.postgresql.external.password | quote }}
  {{- else }}
  value: ""
  {{- end }}
- name: DATABASE_SSLMODE
  value: {{ (ternary "disable" (.Values.postgresql.external.sslMode | default "prefer") (eq .Values.postgresql.source "built-in")) | quote }}
- name: DATABASE_URL
  value: "postgresql://$(DATABASE_USERNAME):$(DATABASE_PASSWORD)@$(DATABASE_HOST):$(DATABASE_PORT)/$(DATABASE_NAME)?sslmode=$(DATABASE_SSLMODE)"
{{- end -}}

{{/* ==== REDIS region ==== */}}

{{/* Must get Redis hostname */}}
{{- define "langwatch.redis.hostname" -}}
{{- if eq .Values.redis.source "built-in" -}}
{{ printf "%s-redis-master" .Release.Name }}
{{- else -}}
{{- required "redis.external.host is required when redis.source != built-in" .Values.redis.external.host -}}
{{- end -}}
{{- end -}}

{{/* Get Redis port (or default) */}}
{{- define "langwatch.redis.port" -}}
{{- if eq .Values.redis.source "built-in" -}}
"6379"
{{- else -}}
{{ (.Values.redis.external.port | default 6379) | toString | quote }}
{{- end -}}
{{- end -}}

{{/* Create Redis env-var set */}}
{{- define "langwatch.redisEnvSet" -}}
- name: REDIS_HOST
  value: {{ include "langwatch.redis.hostname" . | quote }}
- name: REDIS_PORT
  value: {{ include "langwatch.redis.port" . }}
- name: REDIS_PASSWORD
  {{- if and (eq .Values.redis.source "built-in") .Values.autogen.enabled }}
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-redis" .Release.Name | quote }}
      key: "redis-password"
  {{- else if and .Values.secrets.existingSecret (.Values.redis.auth.secretKeys.passwordKey | default "password") }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: {{ (.Values.redis.auth.secretKeys.passwordKey | default "password") | quote }}
  {{- else if .Values.redis.external.password }}
  value: {{ .Values.redis.external.password | quote }}
  {{- else }}
  value: ""
  {{- end }}
- name: REDIS_URL
  value: "redis://:$(REDIS_PASSWORD)@$(REDIS_HOST):$(REDIS_PORT)"
{{- end -}}

{{/* ==== OPENSEARCH region ==== */}}

{{/* Must get OpenSearch hostname */}}
{{- define "langwatch.opensearch.hostname" -}}
{{- if eq .Values.opensearch.source "built-in" -}}
{{ printf "%s-opensearch" .Release.Name }}
{{- else -}}
{{- required "opensearch.external.host is required when opensearch.source != built-in" .Values.opensearch.external.host -}}
{{- end -}}
{{- end -}}

{{/* Get OpenSearch port (or default) */}}
{{- define "langwatch.opensearch.port" -}}
{{- if eq .Values.opensearch.source "built-in" -}}
"9200"
{{- else -}}
{{ (.Values.opensearch.external.port | default 9200) | toString | quote }}
{{- end -}}
{{- end -}}

{{/* Create OpenSearch env-var set */}}
{{- define "langwatch.opensearchEnvSet" -}}
- name: ELASTICSEARCH_NODE_HOST
  value: {{ include "langwatch.opensearch.hostname" . | quote }}
- name: ELASTICSEARCH_NODE_PORT
  value: {{ include "langwatch.opensearch.port" . }}
- name: ELASTICSEARCH_NODE_SCHEME
  value: {{ (eq .Values.opensearch.source "built-in" | ternary "http" "https") | quote }}
- name: ELASTICSEARCH_NODE_USERNAME
  {{- if and .Values.secrets.existingSecret .Values.opensearch.auth.secretKeys }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: {{ (.Values.opensearch.auth.secretKeys.usernameKey | default "opensearch-username") | quote }}
  {{- else }}
  value: {{ default "" .Values.opensearch.external.username | quote }}
  {{- end }}
- name: ELASTICSEARCH_NODE_PASSWORD
  {{- if and .Values.secrets.existingSecret .Values.opensearch.auth.secretKeys }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: {{ (.Values.opensearch.auth.secretKeys.passwordKey | default "opensearch-password") | quote }}
  {{- else }}
  value: {{ default "" .Values.opensearch.external.password | quote }}
  {{- end }}
- name: ELASTICSEARCH_NODE_URL
  value: "$(ELASTICSEARCH_NODE_SCHEME)://$(ELASTICSEARCH_NODE_HOST):$(ELASTICSEARCH_NODE_PORT)"
{{- end -}}

{{/* ==== PROMETHEUS region ==== */}}

{{/* Must get Prometheus hostname */}}
{{- define "langwatch.prometheus.hostname" -}}
{{- if eq .Values.prometheus.source "built-in" -}}
{{ printf "%s-prometheus" .Release.Name }}
{{- else -}}
{{- required "prometheus.external.host is required when prometheus.source != built-in" .Values.prometheus.external.host -}}
{{- end -}}
{{- end -}}

{{/* Get Prometheus port (or default) */}}
{{- define "langwatch.prometheus.port" -}}
{{- if eq .Values.prometheus.source "built-in" -}}
"9090"
{{- else -}}
{{ (.Values.prometheus.external.port | default 9090) | toString | quote }}
{{- end -}}
{{- end -}}

{{/* Create Prometheus env-var set */}}
{{- define "langwatch.prometheusEnv" -}}
- name: PROMETHEUS_HOST
  value: {{ include "langwatch.prometheus.hostname" . | quote }}
- name: PROMETHEUS_PORT
  value: {{ include "langwatch.prometheus.port" . }}
- name: PROMETHEUS_URL
  value: "http://$(PROMETHEUS_HOST):$(PROMETHEUS_PORT)"
- name: PROMETHEUS_USERNAME
  value: {{ default "" .Values.prometheus.external.username | quote }}
- name: PROMETHEUS_PASSWORD
  value: {{ default "" .Values.prometheus.external.password | quote }}
{{- end -}}

{{/* ==== SECRET region ==== */}}

{{/* Must get the primary secret name to reference */}}
{{- define "langwatch.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{ .Values.secrets.existingSecret }}
{{- else if .Values.autogen.enabled -}}
{{ .Values.autogen.secretNames.service | default (printf "%s-service-secrets" .Release.Name) }}
{{- else -}}
{{ fail "No secret configuration found. Set secrets.existingSecret or autogen.enabled=true" }}
{{- end -}}
{{- end -}}

{{/* Must get CRON_API_KEY for CronJobs (no mock value) */}}
{{- define "langwatch.cronApiKey" -}}
{{- if .Values.secrets.existingSecret -}}
{{- $secret := lookup "v1" "Secret" .Release.Namespace .Values.secrets.existingSecret -}}
{{- if $secret -}}
{{- index $secret.data (.Values.secrets.secretKeys.CRON_API_KEY | default "CRON_API_KEY") | b64dec | quote -}}
{{- else -}}
{{- fail (printf "Secret %s not found in namespace %s" .Values.secrets.existingSecret .Release.Namespace) -}}
{{- end -}}
{{- else if .Values.autogen.enabled -}}
""
{{- else -}}
{{- fail "Set secrets.existingSecret or enable autogen.enabled to provide CRON_API_KEY" -}}
{{- end -}}
{{- end -}}

{{/* Must get METRICS_API_KEY for Prometheus scrape auth (no mock value) */}}
{{- define "langwatch.metricsApiKey" -}}
{{- if .Values.secrets.existingSecret -}}
{{- $secret := lookup "v1" "Secret" .Release.Namespace .Values.secrets.existingSecret -}}
{{- if $secret -}}
{{- index $secret.data (.Values.secrets.secretKeys.METRICS_API_KEY | default "METRICS_API_KEY") | b64dec | quote -}}
{{- else -}}
{{- fail (printf "Secret %s not found in namespace %s" .Values.secrets.existingSecret .Release.Namespace) -}}
{{- end -}}
{{- else if .Values.autogen.enabled -}}
""
{{- else -}}
{{- fail "Set secrets.existingSecret or enable autogen.enabled to provide METRICS_API_KEY" -}}
{{- end -}}
{{- end -}}

{{/* ==== VALIDATION region ==== */}}

{{/* Validate secrets configuration */}}
{{- define "langwatch.validateSecrets" -}}
{{- if .Values.autogen.enabled }}
  {{- /* ok – built-ins or subcharts will provide credentials */ -}}
{{- else if .Values.postgresql.auth.password }}
  {{- /* ok – using fixed password for PostgreSQL */ -}}
{{- else if .Values.secrets.existingSecret }}
  {{- if not .Values.secrets.existingSecret }}
    {{- fail "autogen.enabled=false: secrets.existingSecret is required and must include app, PostgreSQL, and Redis credentials." }}
  {{- end }}
  {{- $sec := lookup "v1" "Secret" .Release.Namespace .Values.secrets.existingSecret -}}
  {{- if not $sec -}}
    {{- fail (printf "Secret %s not found in namespace %s" .Values.secrets.existingSecret .Release.Namespace) -}}
  {{- end -}}

  {{- /* App-level required keys */ -}}
  {{- $appKeys := list
        (.Values.secrets.secretKeys.API_TOKEN_JWT_SECRET | default "API_TOKEN_JWT_SECRET")
        (.Values.secrets.secretKeys.CRON_API_KEY | default "CRON_API_KEY")
        (.Values.secrets.secretKeys.METRICS_API_KEY | default "METRICS_API_KEY")
        (.Values.secrets.secretKeys.NEXTAUTH_SECRET | default "NEXTAUTH_SECRET")
    -}}
  {{- range $k := $appKeys -}}
    {{- if not (hasKey $sec.data $k) -}}
      {{- fail (printf "Secret %s must contain key %s" $.Values.secrets.existingSecret $k) -}}
    {{- end -}}
  {{- end -}}

  {{- /* Database keys */ -}}
  {{- $dbUserKey := (.Values.postgresql.auth.secretKeys.usernameKey | default "username") -}}
  {{- $dbPassKey := (.Values.postgresql.auth.secretKeys.userPasswordKey | default "password") -}}
  {{- $dbNameKey := (.Values.postgresql.auth.secretKeys.databaseKey | default "database") -}}
  {{- range $k := (list $dbUserKey $dbPassKey $dbNameKey) -}}
    {{- if not (hasKey $sec.data $k) -}}
      {{- fail (printf "Secret %s must contain database key %s" $.Values.secrets.existingSecret $k) -}}
    {{- end -}}
  {{- end -}}

  {{- /* Redis key (password optional but if configured, must exist) */ -}}
  {{- $redisPassKey := (.Values.redis.auth.secretKeys.passwordKey | default "password") -}}
  {{- if (hasKey .Values.redis "auth") -}}
    {{- if not (hasKey $sec.data $redisPassKey) -}}
      {{- fail (printf "Secret %s must contain Redis key %s" $.Values.secrets.existingSecret $redisPassKey) -}}
    {{- end -}}
  {{- end -}}
{{- else }}
  {{- fail "Must set either: autogen.enabled=true, postgresql.auth.password, or secrets.existingSecret" }}
{{- end -}}
{{- end -}}
