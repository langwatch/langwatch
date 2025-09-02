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

