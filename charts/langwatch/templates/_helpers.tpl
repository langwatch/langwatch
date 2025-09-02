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
{{- define "langwatch.postgres.hostname" -}}
{{- if eq .Values.postgres.source "built-in" }}
{{- printf "%s-postgresql" .Release.Name -}}
{{- else }}
{{- .Values.postgres.external.host }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL port
*/}}
{{- define "langwatch.postgres.port" -}}
{{- if eq .Values.postgres.source "built-in" }}
{{- .Values.postgres.primary.service.ports.postgresql | toString | int }}
{{- else }}
{{- .Values.postgres.external.port | default 5432 | toString | int }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL database name
*/}}
{{- define "langwatch.postgres.database" -}}
{{- if eq .Values.postgres.source "built-in" }}
{{- .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.external.database }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL username
*/}}
{{- define "langwatch.postgres.username" -}}
{{- if eq .Values.postgres.source "built-in" }}
{{- .Values.postgres.auth.username }}
{{- else }}
{{- .Values.postgres.external.username }}
{{- end }}
{{- end }}

{{/*
Return PostgreSQL password
*/}}
{{- define "langwatch.postgres.password" -}}
{{- if eq .Values.postgres.source "built-in" }}
{{- .Values.postgres.auth.password }}
{{- else }}
{{- .Values.postgres.external.password }}
{{- end }}
{{- end }}

{{/*
Generate DATABASE_URL based on configuration
*/}}
{{- define "langwatch.postgres.databaseUrl" -}}
{{- if eq .Values.postgres.source "built-in" }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=%s" .Values.postgres.auth.username .Values.postgres.auth.password (include "langwatch.postgres.hostname" .) (include "langwatch.postgres.port" . | toString) .Values.postgres.auth.database .Values.postgres.auth.database }}
{{- else if .Values.postgres.external.connectionString }}
{{- .Values.postgres.external.connectionString }}
{{- else }}
{{- printf "postgresql://%s:%s@%s:%s/%s?sslmode=%s" .Values.postgres.external.username .Values.postgres.external.password .Values.postgres.external.host (.Values.postgres.external.port | default 5432 | toString) .Values.postgres.external.database (.Values.postgres.external.sslMode | default "prefer") }}
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
{{- printf "%s-opensearch-master" .Release.Name -}}
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
