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
{{- include "gateway.validateShutdownBudget" . }}
{{- end }}

{{/* Holds the pod's SIGKILL clock above the drain budget it has to cover.
     terminationGracePeriodSeconds and the drain timing both start at the same
     SIGTERM, so raising preDrainWaitSeconds or timeoutSeconds without raising
     it leaves the kubelet killing the pod mid-drain. That failure reads
     exactly like the stuck-handler symptom in the production runbook and is
     not one, which is why it is worth refusing the render over.

     Validated rather than derived: an operator whose load balancer is slow to
     drop endpoints wants a wider margin than any formula would pick, so the
     number stays theirs to set. 10s of slack covers process start-up and the
     kubelet's own bookkeeping between signal and kill. */}}
{{- define "gateway.validateShutdownBudget" -}}
{{- $drain := int .Values.shutdown.preDrainWaitSeconds }}
{{- $timeout := int .Values.shutdown.timeoutSeconds }}
{{- $slack := 10 }}
{{- $granted := int (.Values.terminationGracePeriodSeconds | default 30) }}
{{- $required := add $drain $timeout $slack }}
{{- if lt $granted (int $required) }}
{{- fail (printf "terminationGracePeriodSeconds is %d, too short for the configured drain: shutdown.preDrainWaitSeconds (%d) + shutdown.timeoutSeconds (%d) + %ds of slack needs at least %d. Raise terminationGracePeriodSeconds to %d or more, or lower the drain timing." $granted $drain $timeout $slack $required $required) }}
{{- end }}
{{- /* Voice calls run on their own clock from the same SIGTERM: the drain,
       then 30s to end what is left and send the final usage reports. */}}
{{- $voice := int .Values.shutdown.voiceDrainSeconds }}
{{- $voiceRequired := add $voice 30 5 }}
{{- if lt $granted (int $voiceRequired) }}
{{- fail (printf "terminationGracePeriodSeconds is %d, too short for the voice call drain: shutdown.voiceDrainSeconds (%d) + 30s to end the remaining calls + 5s of slack needs at least %d. Raise terminationGracePeriodSeconds to %d or more, or lower shutdown.voiceDrainSeconds." $granted $voice $voiceRequired $voiceRequired) }}
{{- end }}
{{- end }}

{{/*
A PodDisruptionBudget field as a pod count, the way Kubernetes resolves it:
an integer as written, a percentage of `replicas` rounded up (Kubernetes
rounds both minAvailable and maxUnavailable percentages up).
Usage: {{ include "gateway.pdbPods" (dict "value" $v "replicas" $replicas) | int }}
*/}}
{{- define "gateway.pdbPods" -}}
{{- $v := toString .value -}}
{{- if hasSuffix "%" $v -}}
{{- $pct := int (trimSuffix "%" $v) -}}
{{- div (add (mul $pct (int .replicas)) 99) 100 -}}
{{- else -}}
{{- int $v -}}
{{- end -}}
{{- end -}}

{{/*
  This chart renders no Ingress. The langwatch chart publishes the gateway
  from its own app Ingress (ingress.gateway.host), so a leftover ingress block
  here would otherwise be dropped without a word and the public route with it.
  `ingress.enabled: false` on its own asks for nothing and is accepted.
*/}}
{{- define "gateway.validateIngressValues" -}}
{{- with .Values.ingress }}
{{- $rest := omit . "enabled" }}
{{- if or .enabled $rest }}
{{- fail "gateway ingress values (gateway.ingress.* in the langwatch chart) are no longer supported: the gateway chart renders no Ingress. In the langwatch chart set ingress.gateway.host (and ingress.gateway.tls.secretName) to publish the gateway on the app Ingress, with the same className and annotations. Installed on its own, route to this chart's Service yourself. Remove the gateway ingress block. See https://docs.langwatch.ai/self-hosting/deployment/routing" }}
{{- end }}
{{- end }}
{{- end -}}
