{{- define "langyagent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "langyagent.fullname" -}}
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

{{- define "langyagent.labels" -}}
app.kubernetes.io/name: {{ include "langyagent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: langyagent
{{- end }}

{{- /* The labels that pick this release's pods: the Deployment selector, the
       Service selector, the NetworkPolicy podSelector and the PDB selector all
       render from here. `selectorLabels` replaces the default pair entirely.
       It exists for one case: handing an existing Deployment over to this
       chart. A Deployment's spec.selector is immutable, so an install whose
       Deployment was created with other labels can only keep running in place
       if the chart renders that same selector. Leave it empty on a fresh
       install. */ -}}
{{- define "langyagent.selectorLabels" -}}
{{- if .Values.selectorLabels -}}
{{ toYaml .Values.selectorLabels }}
{{- else -}}
app.kubernetes.io/name: {{ include "langyagent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
{{- end }}

{{- /* Pod-template labels: the selector labels plus `podLabels`. The selector
       labels win on a shared key, because a pod whose labels stop matching its
       Deployment's selector is rejected by the API server. */ -}}
{{- define "langyagent.podLabels" -}}
{{- $selector := include "langyagent.selectorLabels" . | fromYaml }}
{{- toYaml (merge $selector (deepCopy (.Values.podLabels | default dict))) }}
{{- end }}
