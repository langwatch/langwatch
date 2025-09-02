{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "langwatch.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "langwatch.labels" -}}
helm.sh/chart: {{ include "langwatch.chart" . }}
{{ include "langwatch.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: langwatch
{{- end }}

{{/*
Selector labels
*/}}
{{- define "langwatch.selectorLabels" -}}
app.kubernetes.io/name: {{ .Release.Name }}-app
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Return PostgreSQL hostname
*/}}
{{- define "langwatch.postgresql.hostname" -}}
{{- if eq .Values.postgresql.source "built-in" }}
{{- printf "%s-postgresql" .Release.Name -}}
{{- else }}
{{- .Values.postgresql.external.host }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL port
*/}}
{{- define "langwatch.postgresql.port" -}}
{{- if eq .Values.postgresql.source "built-in" }}
{{- 5432 | toString | int }}
{{- else }}
{{- .Values.postgresql.external.port | default 5432 | toString | int }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL database name
*/}}
{{- define "langwatch.postgresql.database" -}}
{{- if eq .Values.postgresql.source "built-in" }}
{{- .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.postgresql.external.database }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL username
*/}}
{{- define "langwatch.postgresql.username" -}}
{{- if eq .Values.postgresql.source "built-in" }}
{{- .Values.postgresql.auth.username }}
{{- else }}
{{- .Values.postgresql.external.username }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL password
*/}}
{{- define "langwatch.postgresql.password" -}}
{{- if eq .Values.postgresql.source "built-in" }}
{{- .Values.postgresql.auth.password }}
{{- else }}
{{- .Values.postgresql.external.password }}
{{- end }}
{{- end }}

{{/*
Generate DATABASE_URL based on configuration
*/}}
{{- define "langwatch.postgresql.databaseUrl" -}}
{{- if eq .Values.postgresql.source "built-in" }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=%s" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "langwatch.postgresql.hostname" .) (include "langwatch.postgresql.port" . | toString) .Values.postgresql.auth.database .Values.postgresql.auth.database }}
{{- else if .Values.postgresql.external.connectionString }}
{{- .Values.postgresql.external.connectionString }}
{{- else }}
{{- printf "postgresql://%s:%s@%s:%s/%s?sslmode=%s" .Values.postgresql.external.username .Values.postgresql.external.password .Values.postgresql.external.host (.Values.postgresql.external.port | default 5432 | toString) .Values.postgresql.external.database (.Values.postgresql.external.sslMode | default "prefer") }}
{{- end }}
{{- end }}

{{/*
Return Redis hostname
*/}}
{{- define "langwatch.redis.hostname" -}}
{{- if eq .Values.redis.source "built-in" }}
{{- printf "%s-redis-master" .Release.Name -}}
{{- else }}
{{- .Values.redis.external.host }}
{{- end }}
{{- end }}

{{/*
Return Redis port
*/}}
{{- define "langwatch.redis.port" -}}
{{- if eq .Values.redis.source "built-in" }}
{{- 6379 | toString }}
{{- else }}
{{- .Values.redis.external.port | default 6379 | toString }}
{{- end }}
{{- end }}

{{/*
Generate Redis connection URL
*/}}
{{- define "langwatch.redis.connectionUrl" -}}
{{- if eq .Values.redis.source "built-in" }}
{{- if .Values.redis.auth.password }}
{{- printf "redis://:%s@%s:%s" .Values.redis.auth.password (include "langwatch.redis.hostname" .) (include "langwatch.redis.port" .) }}
{{- else }}
{{- printf "redis://%s:%s" (include "langwatch.redis.hostname" .) (include "langwatch.redis.port" .) }}
{{- end }}
{{- else if .Values.redis.external.connectionString }}
{{- .Values.redis.external.connectionString }}
{{- else }}
{{- if .Values.redis.external.password }}
{{- printf "redis://:%s@%s:%s" .Values.redis.external.password .Values.redis.external.host (.Values.redis.external.port | default 6379 | toString) }}
{{- else }}
{{- printf "redis://%s:%s" .Values.redis.external.host (.Values.redis.external.port | default 6379 | toString) }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Return OpenSearch hostname
*/}}
{{- define "langwatch.opensearch.hostname" -}}
{{- if eq .Values.opensearch.source "built-in" }}
{{- printf "%s-opensearch" .Release.Name -}}
{{- else }}
{{- .Values.opensearch.external.host }}
{{- end }}
{{- end }}

{{/*
Return OpenSearch port
*/}}
{{- define "langwatch.opensearch.port" -}}
{{- if eq .Values.opensearch.source "built-in" }}
{{- 9200 | toString }}
{{- else }}
{{- .Values.opensearch.external.port | default 9200 | toString }}
{{- end }}
{{- end }}

{{/*
Generate OpenSearch URL
*/}}
{{- define "langwatch.opensearch.url" -}}
{{- if eq .Values.opensearch.source "built-in" }}
{{- printf "http://%s:%s" (include "langwatch.opensearch.hostname" .) (include "langwatch.opensearch.port" .) }}
{{- else if .Values.opensearch.external.connectionString }}
{{- .Values.opensearch.external.connectionString }}
{{- else }}
{{- if and .Values.opensearch.external.username .Values.opensearch.external.password }}
{{- printf "https://%s:%s@%s:%s" .Values.opensearch.external.username .Values.opensearch.external.password .Values.opensearch.external.host (.Values.opensearch.external.port | default 9200 | toString) }}
{{- else }}
{{- printf "https://%s:%s" .Values.opensearch.external.host (.Values.opensearch.external.port | default 9200 | toString) }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Return Prometheus hostname
*/}}
{{- define "langwatch.prometheus.hostname" -}}
{{- if eq .Values.prometheus.source "built-in" }}
{{- printf "%s-prometheus" .Release.Name -}}
{{- else }}
{{- .Values.prometheus.external.host }}
{{- end }}
{{- end }}

{{/*
Return Prometheus port
*/}}
{{- define "langwatch.prometheus.port" -}}
{{- if eq .Values.prometheus.source "built-in" }}
{{- 9090 | toString }}
{{- else }}
{{- .Values.prometheus.external.port | default 9090 | toString }}
{{- end }}
{{- end }}

{{/*
Generate Prometheus URL
*/}}
{{- define "langwatch.prometheus.url" -}}
{{- if eq .Values.prometheus.source "built-in" }}
{{- printf "http://%s:%s" (include "langwatch.prometheus.hostname" .) (include "langwatch.prometheus.port" .) }}
{{- else if .Values.prometheus.external.connectionString }}
{{- .Values.prometheus.external.connectionString }}
{{- else }}
{{- if and .Values.prometheus.external.username .Values.prometheus.external.password }}
{{- printf "http://%s:%s@%s:%s" .Values.prometheus.external.username .Values.prometheus.external.password .Values.prometheus.external.host (.Values.prometheus.external.port | default 9090 | toString) }}
{{- else }}
{{- printf "http://%s:%s" .Values.prometheus.external.host (.Values.prometheus.external.port | default 9090 | toString) }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Validate secrets configuration
*/}}
{{- define "langwatch.validateSecrets" -}}
{{- if and (not .Values.secrets.existingSecret) (not .Values.autogen.enabled) }}
{{- fail "Either secrets.existingSecret must be set OR autogen.enabled must be true. Please configure one of these options for secure secrets handling." }}
{{- end }}
{{- end }}

{{/*
Get secret name for a service
*/}}
{{- define "langwatch.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else if .Values.autogen.enabled }}
{{- .Values.autogen.secretNames.service | default (printf "%s-service-secrets" .Release.Name) }}
{{- else }}
{{- fail "No secret configuration found. Please set either secrets.existingSecret or autogen.enabled=true" }}
{{- end }}
{{- end }}

{{/*
Get CRON_API_KEY for cronjobs (no mocks)
*/}}
{{- define "langwatch.cronApiKey" -}}
{{- if .Values.secrets.existingSecret }}
{{- $secret := lookup "v1" "Secret" .Release.Namespace .Values.secrets.existingSecret }}
{{- if $secret }}{{- index $secret.data .Values.secrets.secretKeys.CRON_API_KEY | b64dec | quote }}{{- else }}{{- fail (printf "Secret %s not found in namespace %s" .Values.secrets.existingSecret .Release.Namespace) }}{{- end }}
{{- else if .Values.autogen.enabled }}
{{- "" -}}
{{- else }}
{{- fail "No secret configuration found. Please set either secrets.existingSecret or autogen.enabled=true" }}
{{- end }}
{{- end }}

{{/*
Get METRICS_API_KEY for Prometheus (no mocks)
*/}}
{{- define "langwatch.metricsApiKey" -}}
{{- if .Values.secrets.existingSecret }}
{{- $secret := lookup "v1" "Secret" .Release.Namespace .Values.secrets.existingSecret }}
{{- if $secret }}{{- index $secret.data .Values.secrets.secretKeys.METRICS_API_KEY | b64dec | quote }}{{- else }}{{- fail (printf "Secret %s not found in namespace %s" .Values.secrets.existingSecret .Release.Namespace) }}{{- end }}
{{- else if .Values.autogen.enabled }}
{{- "" -}}
{{- else }}
{{- fail "No secret configuration found. Please set either secrets.existingSecret or autogen.enabled=true" }}
{{- end }}
{{- end }}
