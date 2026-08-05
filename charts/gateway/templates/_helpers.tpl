{{- define "gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "gateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "gateway.labels" -}}
app.kubernetes.io/name: {{ include "gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: ai-gateway
{{- end }}

{{- define "gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Refuses a values file that still carries the duration-string shutdown keys.
     Helm merges unknown keys in silently, so an operator who kept them would
     get a release that renders and installs while their drain timing quietly
     falls back to the chart defaults. Failing the render is the only way they
     find out at the moment they can still act on it. */}}
{{- define "gateway.validateShutdownValues" -}}
{{- if hasKey .Values.shutdown "preDrainWait" }}
{{- fail (printf "shutdown.preDrainWait is not a chart value. Use shutdown.preDrainWaitSeconds, a plain integer count of seconds (found: %v)." .Values.shutdown.preDrainWait) }}
{{- end }}
{{- if hasKey .Values.shutdown "timeout" }}
{{- fail (printf "shutdown.timeout is not a chart value. Use shutdown.timeoutSeconds, a plain integer count of seconds (found: %v)." .Values.shutdown.timeout) }}
{{- end }}
{{- end }}
