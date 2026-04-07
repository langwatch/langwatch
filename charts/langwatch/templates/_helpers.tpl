{{/* Our Label */}}
{{- define "langwatch.chart" }}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common label set */}}
{{- define "langwatch.labels" }}
helm.sh/chart: {{ include "langwatch.chart" . }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: langwatch
{{- end }}

{{/* Selector labels (must match .spec.selector and pod labels) */}}
{{- define "langwatch.selectorLabels" }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Secret validation function */}}
{{- define "langwatch.validateSecrets" }}
{{- $errors := list }}
{{- $warnings := list }}

{{/* Check if autogen is disabled but no existing secret is provided */}}
{{- if not .Values.autogen.enabled }}
  {{- if empty .Values.secrets.existingSecret }}
    {{- $errors = append $errors "autogen is disabled but no existingSecret is provided. Either enable autogen or provide an existingSecret" }}
  {{- end }}
{{- end }}

{{/* Validate required secrets when using existingSecret */}}
{{- if .Values.secrets.existingSecret }}
  {{- if empty .Values.secrets.secretKeys.credentialsEncryptionKey }}
    {{- $warnings = append $warnings "secrets.secretKeys.credentialsEncryptionKey not specified, using default key 'credentialsEncryptionKey'" }}
  {{- end }}
{{- end }}

{{/* Validate app secrets configuration */}}
{{- if .Values.app.credentialsEncryptionKey.secretKeyRef.name }}
  {{- if empty .Values.app.credentialsEncryptionKey.secretKeyRef.key }}
    {{- $errors = append $errors "app.credentialsEncryptionKey.secretKeyRef.name is set but key is empty" }}
  {{- end }}
{{- else if empty .Values.app.credentialsEncryptionKey.value }}
  {{- if not .Values.autogen.enabled }}
    {{- if empty .Values.secrets.existingSecret }}
      {{- $errors = append $errors "app.credentialsEncryptionKey must have either value, secretKeyRef, or autogen must be enabled" }}
    {{- end }}
  {{- end }}
{{- end }}

{{- if .Values.app.cronApiKey.secretKeyRef.name }}
  {{- if empty .Values.app.cronApiKey.secretKeyRef.key }}
    {{- $errors = append $errors "app.cronApiKey.secretKeyRef.name is set but key is empty" }}
  {{- end }}
{{- else if empty .Values.app.cronApiKey.value }}
  {{- if not .Values.autogen.enabled }}
    {{- if empty .Values.secrets.existingSecret }}
      {{- $errors = append $errors "app.cronApiKey must have either value, secretKeyRef, or autogen must be enabled" }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Validate NextAuth secret */}}
{{- if .Values.app.nextAuth.secret.secretKeyRef.name }}
  {{- if empty .Values.app.nextAuth.secret.secretKeyRef.key }}
    {{- $errors = append $errors "app.nextAuth.secret.secretKeyRef.name is set but key is empty" }}
  {{- end }}
{{- else if empty .Values.app.nextAuth.secret.value }}
  {{- if not .Values.autogen.enabled }}
    {{- if empty .Values.secrets.existingSecret }}
      {{- $errors = append $errors "app.nextAuth.secret must have either value, secretKeyRef, or autogen must be enabled" }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Validate evaluators secrets */}}
{{- if .Values.app.evaluators.azureOpenAI.enabled }}
  {{- if .Values.app.evaluators.azureOpenAI.endpoint.secretKeyRef.name }}
    {{- if empty .Values.app.evaluators.azureOpenAI.endpoint.secretKeyRef.key }}
      {{- $errors = append $errors "app.evaluators.azureOpenAI.endpoint.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.app.evaluators.azureOpenAI.endpoint.value }}
    {{- $errors = append $errors "app.evaluators.azureOpenAI.enabled is true but endpoint is not configured" }}
  {{- end }}
  
  {{- if .Values.app.evaluators.azureOpenAI.apiKey.secretKeyRef.name }}
    {{- if empty .Values.app.evaluators.azureOpenAI.apiKey.secretKeyRef.key }}
      {{- $errors = append $errors "app.evaluators.azureOpenAI.apiKey.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.app.evaluators.azureOpenAI.apiKey.value }}
    {{- $errors = append $errors "app.evaluators.azureOpenAI.enabled is true but apiKey is not configured" }}
  {{- end }}
{{- end }}

{{- if .Values.app.evaluators.google.enabled }}
  {{- if .Values.app.evaluators.google.credentials.secretKeyRef.name }}
    {{- if empty .Values.app.evaluators.google.credentials.secretKeyRef.key }}
      {{- $errors = append $errors "app.evaluators.google.credentials.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.app.evaluators.google.credentials.value }}
    {{- $errors = append $errors "app.evaluators.google.enabled is true but credentials is not configured" }}
  {{- end }}
{{- end }}

{{/* Validate dataset storage secrets */}}
{{- if .Values.app.datasetObjectStorage.enabled }}
  {{- if eq .Values.app.datasetObjectStorage.provider "awsS3" }}
    {{- if .Values.app.datasetObjectStorage.providers.awsS3.endpoint.secretKeyRef.name }}
      {{- if empty .Values.app.datasetObjectStorage.providers.awsS3.endpoint.secretKeyRef.key }}
        {{- $errors = append $errors "app.datasetObjectStorage.providers.awsS3.endpoint.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
    
    {{- if .Values.app.datasetObjectStorage.providers.awsS3.accessKeyId.secretKeyRef.name }}
      {{- if empty .Values.app.datasetObjectStorage.providers.awsS3.accessKeyId.secretKeyRef.key }}
        {{- $errors = append $errors "app.datasetObjectStorage.providers.awsS3.accessKeyId.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
    
    {{- if .Values.app.datasetObjectStorage.providers.awsS3.secretAccessKey.secretKeyRef.name }}
      {{- if empty .Values.app.datasetObjectStorage.providers.awsS3.secretAccessKey.secretKeyRef.key }}
        {{- $errors = append $errors "app.datasetObjectStorage.providers.awsS3.secretAccessKey.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
    
    {{- if .Values.app.datasetObjectStorage.providers.awsS3.keySalt.secretKeyRef.name }}
      {{- if empty .Values.app.datasetObjectStorage.providers.awsS3.keySalt.secretKeyRef.key }}
        {{- $errors = append $errors "app.datasetObjectStorage.providers.awsS3.keySalt.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Validate email provider secrets */}}
{{- if .Values.app.email.enabled }}
  {{- if eq .Values.app.email.provider "sendgrid" }}
    {{- if .Values.app.email.providers.sendgrid.apiKey.secretKeyRef.name }}
      {{- if empty .Values.app.email.providers.sendgrid.apiKey.secretKeyRef.key }}
        {{- $errors = append $errors "app.email.providers.sendgrid.apiKey.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- else if empty .Values.app.email.providers.sendgrid.apiKey.value }}
      {{- $errors = append $errors "app.email.enabled is true with sendgrid provider but apiKey is not configured" }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Validate NextAuth OAuth provider secrets */}}
{{- $oauthProviders := list "auth0" "azureAd" "cognito" "github" "gitlab" "google" "okta" }}
{{- range $provider := $oauthProviders }}
  {{- $providerConfig := index $.Values.app.nextAuth.providers $provider }}
  {{- if $providerConfig }}
    {{- if $providerConfig.clientId.secretKeyRef.name }}
      {{- if not $providerConfig.clientId.secretKeyRef.key }}
        {{- $errors = append $errors (printf "app.nextAuth.providers.%s.clientId.secretKeyRef.name is set but key is empty" $provider) }}
      {{- end }}
    {{- end }}
    
    {{- if $providerConfig.clientSecret.secretKeyRef.name }}
      {{- if not $providerConfig.clientSecret.secretKeyRef.key }}
        {{- $errors = append $errors (printf "app.nextAuth.providers.%s.clientSecret.secretKeyRef.name is set but key is empty" $provider) }}
      {{- end }}
    {{- end }}
    
    {{- if and (has $provider (list "auth0" "cognito" "okta")) $providerConfig.issuer }}
      {{- if $providerConfig.issuer.secretKeyRef.name }}
        {{- if not $providerConfig.issuer.secretKeyRef.key }}
          {{- $errors = append $errors (printf "app.nextAuth.providers.%s.issuer.secretKeyRef.name is set but key is empty" $provider) }}
        {{- end }}
      {{- end }}
    {{- end }}
    
    {{- if eq $provider "azureAd" }}
      {{- if $providerConfig.tenantId.secretKeyRef.name }}
        {{- if not $providerConfig.tenantId.secretKeyRef.key }}
          {{- $errors = append $errors "app.nextAuth.providers.azureAd.tenantId.secretKeyRef.name is set but key is empty" }}
        {{- end }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Validate telemetry secrets */}}
{{- if .Values.app.telemetry.metrics.enabled }}
  {{- if .Values.app.telemetry.metrics.apiKey.secretKeyRef.name }}
    {{- if empty .Values.app.telemetry.metrics.apiKey.secretKeyRef.key }}
      {{- $errors = append $errors "app.telemetry.metrics.apiKey.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.app.telemetry.metrics.apiKey.value }}
    {{- $errors = append $errors "app.telemetry.metrics.enabled is true but apiKey is not configured" }}
  {{- end }}
{{- end }}

{{/* Validate ClickHouse configuration */}}
{{- if not .Values.clickhouse.chartManaged }}
  {{- if .Values.clickhouse.external.url.secretKeyRef.name }}
    {{- if empty .Values.clickhouse.external.url.secretKeyRef.key }}
      {{- $errors = append $errors "clickhouse.external.url.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.clickhouse.external.url.value }}
    {{- $errors = append $errors "clickhouse.chartManaged is false but external.url is not configured" }}
  {{- end }}
{{- else }}
  {{- $chValues := .Values.clickhouse }}
  {{- $replicas := $chValues.replicas | int }}
  {{- if and (gt $replicas 1) (eq (mod $replicas 2) 0) }}
    {{- $errors = append $errors "clickhouse.replicas must be odd (1, 3, 5, 7) for Keeper quorum" }}
  {{- end }}
  {{/* ClickHouse subchart auto-generates its password via lookup/randAlphaNum — no autogen gate needed */}}
  {{- if or $chValues.cold.enabled $chValues.backup.enabled }}
    {{- if empty $chValues.objectStorage.bucket }}
      {{- $errors = append $errors "clickhouse.objectStorage.bucket is required when cold.enabled or backup.enabled" }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Redis secret template auto-generates its password via lookup/randAlphaNum — no autogen gate needed */}}

{{- if not .Values.redis.chartManaged }}
  {{- if .Values.redis.external.connectionString.secretKeyRef.name }}
    {{- if empty .Values.redis.external.connectionString.secretKeyRef.key }}
      {{- $errors = append $errors "redis.external.connectionString.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.redis.external.connectionString.value }}
    {{- $errors = append $errors "redis.chartManaged is false but connectionString is not configured" }}
  {{- end }}
{{- end }}

{{- if not .Values.postgresql.chartManaged }}
  {{- if .Values.postgresql.external.connectionString.secretKeyRef.name }}
    {{- if empty .Values.postgresql.external.connectionString.secretKeyRef.key }}
      {{- $errors = append $errors "postgresql.external.connectionString.secretKeyRef.name is set but key is empty" }}
    {{- end }}
  {{- else if empty .Values.postgresql.external.connectionString.value }}
    {{- $errors = append $errors "postgresql.chartManaged is false but connectionString is not configured" }}
  {{- end }}
{{/* PostgreSQL secret template auto-generates its password via lookup/randAlphaNum — no autogen gate needed */}}
{{- end }}

{{- if not .Values.prometheus.chartManaged }}
  {{- if .Values.prometheus.external.existingSecret }}
    {{- if empty .Values.prometheus.external.secretKeys.host }}
      {{- $errors = append $errors "prometheus.external.existingSecret is set but secretKeys.host is not configured" }}
    {{- end }}
    {{- if empty .Values.prometheus.external.secretKeys.port }}
      {{- $errors = append $errors "prometheus.external.existingSecret is set but secretKeys.port is not configured" }}
    {{- end }}
  {{- end }}
  {{/* Prometheus is optional — no error when chartManaged=false and no external config */}}
{{- end }}

{{/* Output errors and warnings */}}
{{- if $errors }}
{{- fail (printf "Secret validation failed:\n%s" (join "\n" $errors)) }}
{{- end }}

{{- if $warnings }}
{{- range $warning := $warnings }}
{{- printf "WARNING: %s\n" $warning }}
{{- end }}
{{- end }}

{{- end }}

{{/* ============================================================ */}}
{{/* Shared Environment Variables                                  */}}
{{/* ============================================================ */}}
{{/* Common env vars shared between app and workers deployments */}}

{{- define "langwatch.sharedEnv" }}
- name: NODE_ENV
  value: {{ .Values.app.nodeEnv | default .Values.global.env | default "production" }}

- name: BASE_HOST
  value: {{ .Values.app.http.baseHost | default "http://localhost:5560" }}

- name: SKIP_ENV_VALIDATION
  value: {{ .Values.app.features.skipEnvValidation | default false | quote }}
- name: SKIP_ELASTIC_MIGRATE
  value: "true"
- name: DISABLE_PII_REDACTION
  value: {{ .Values.app.features.disablePiiRedaction | default false | quote }}

- name: LANGWATCH_NLP_SERVICE
  value: {{ .Values.app.upstreams.nlp.scheme | default "http" }}://{{ .Values.app.upstreams.nlp.name | default (printf "%s-langwatch-nlp" .Release.Name) }}:{{ .Values.app.upstreams.nlp.port | default 5561 }}
- name: LANGEVALS_ENDPOINT
  value: {{ .Values.app.upstreams.langevals.scheme | default "http" }}://{{ .Values.app.upstreams.langevals.name | default (printf "%s-langevals" .Release.Name) }}:{{ .Values.app.upstreams.langevals.port | default 5562 }}

# PostgreSQL connection string
{{- if .Values.postgresql.chartManaged }}
- name: PGUSER
  value: {{ default "postgres" .Values.postgresql.auth.username | quote }}
- name: PGPASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ if .Values.postgresql.auth.existingSecret }}{{ .Values.postgresql.auth.existingSecret }}{{ else }}{{ .Release.Name }}-postgresql{{ end }}
      key: {{ if .Values.postgresql.auth.existingSecret }}{{ if eq (default "postgres" .Values.postgresql.auth.username) "postgres" }}{{ .Values.postgresql.auth.secretKeys.adminPasswordKey | default "postgres-password" }}{{ else }}{{ .Values.postgresql.auth.secretKeys.passwordKey | default "password" }}{{ end }}{{ else }}{{ if eq (default "postgres" .Values.postgresql.auth.username) "postgres" }}postgres-password{{ else }}password{{ end }}{{ end }}
- name: PGHOST
  value: "{{ .Release.Name }}-postgresql"
- name: PGDATABASE
  value: {{ .Values.postgresql.auth.database | quote }}
- name: DATABASE_URL
  value: "postgresql://$(PGUSER):$(PGPASSWORD)@$(PGHOST):5432/$(PGDATABASE)"
{{- else }}
- name: DATABASE_URL
  {{- if .Values.postgresql.external.connectionString.value }}
  value: {{ .Values.postgresql.external.connectionString.value | quote }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.external.connectionString.secretKeyRef.name }}
      key: {{ .Values.postgresql.external.connectionString.secretKeyRef.key }}
  {{- end }}
{{- end }}

# Redis connection string
{{- if .Values.redis.chartManaged }}
{{- if .Values.redis.auth.enabled }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ if .Values.redis.auth.existingSecret }}{{ .Values.redis.auth.existingSecret }}{{ else }}{{ .Release.Name }}-redis{{ end }}
      key: {{ if .Values.redis.auth.existingSecret }}{{ .Values.redis.auth.secretKeys.passwordKey | default "password" }}{{ else }}redis-password{{ end }}
- name: REDIS_HOST
  value: "{{ .Release.Name }}-redis-master"
- name: REDIS_URL
  value: "redis://:$(REDIS_PASSWORD)@$(REDIS_HOST):6379"
{{- else }}
- name: REDIS_URL
  value: "redis://{{ .Release.Name }}-redis-master:6379"
{{- end }}
{{- else }}
{{- if eq .Values.redis.external.architecture "standalone" }}
- name: REDIS_URL
{{- else}}
- name: REDIS_CLUSTER_ENDPOINTS
{{- end }}
{{- if .Values.redis.external.connectionString.value }}
  value: {{ .Values.redis.external.connectionString.value | quote }}
{{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.redis.external.connectionString.secretKeyRef.name }}
      key: {{ .Values.redis.external.connectionString.secretKeyRef.key }}
{{- end }}
{{- end }}

# ClickHouse connection
{{- if .Values.clickhouse.chartManaged }}
- name: CLICKHOUSE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "langwatch.clickhouse.secretName" . }}
      key: {{ include "langwatch.clickhouse.secretKey" . }}
- name: CLICKHOUSE_URL
  value: "http://default:$(CLICKHOUSE_PASSWORD)@{{ .Release.Name }}-clickhouse:8123/langwatch"
{{- if gt (int (.Values.clickhouse).replicas) 1 }}
- name: CLICKHOUSE_CLUSTER
  value: "langwatch"
{{- end }}
{{- else }}
- name: CLICKHOUSE_URL
  {{- if .Values.clickhouse.external.url.value }}
  value: {{ .Values.clickhouse.external.url.value | quote }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.clickhouse.external.url.secretKeyRef.name }}
      key: {{ .Values.clickhouse.external.url.secretKeyRef.key }}
  {{- end }}
{{- if .Values.clickhouse.external.cluster }}
- name: CLICKHOUSE_CLUSTER
  value: {{ .Values.clickhouse.external.cluster | quote }}
{{- end }}
{{- end }}
{{- $chCold := (.Values.clickhouse).cold }}
{{- if $chCold.enabled }}
- name: CLICKHOUSE_COLD_STORAGE_ENABLED
  value: "true"
- name: CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS
  value: {{ $chCold.defaultTtlDays | default "49" | quote }}
{{- end }}

# Credentials encryption key
{{- if .Values.app.credentialsEncryptionKey.secretKeyRef.name }}
- name: CREDENTIALS_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.app.credentialsEncryptionKey.secretKeyRef.name }}
      key: {{ .Values.app.credentialsEncryptionKey.secretKeyRef.key }}
{{- else if .Values.secrets.existingSecret }}
- name: CREDENTIALS_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.secretKeys.credentialsEncryptionKey | default "credentialsEncryptionKey" }}
{{- else if .Values.autogen.enabled }}
- name: CREDENTIALS_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.autogen.secretNames.app | default (printf "%s-app-secrets" .Release.Name) }}
      key: credentialsEncryptionKey
{{- end }}

# Evaluators - Azure OpenAI Integration
{{- if .Values.app.evaluators.azureOpenAI.enabled }}
{{- if .Values.app.evaluators.azureOpenAI.endpoint.secretKeyRef.name }}
- name: AZURE_OPENAI_ENDPOINT
  valueFrom:
    secretKeyRef:
      name: {{ .Values.app.evaluators.azureOpenAI.endpoint.secretKeyRef.name }}
      key: {{ .Values.app.evaluators.azureOpenAI.endpoint.secretKeyRef.key }}
{{- else if .Values.app.evaluators.azureOpenAI.endpoint.value }}
- name: AZURE_OPENAI_ENDPOINT
  value: {{ .Values.app.evaluators.azureOpenAI.endpoint.value | quote }}
{{- end }}
{{- if .Values.app.evaluators.azureOpenAI.apiKey.secretKeyRef.name }}
- name: AZURE_OPENAI_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.app.evaluators.azureOpenAI.apiKey.secretKeyRef.name }}
      key: {{ .Values.app.evaluators.azureOpenAI.apiKey.secretKeyRef.key }}
{{- else if .Values.app.evaluators.azureOpenAI.apiKey.value }}
- name: AZURE_OPENAI_KEY
  value: {{ .Values.app.evaluators.azureOpenAI.apiKey.value | quote }}
{{- end }}
{{- end }}

# Evaluators - Google AI Integration
{{- if .Values.app.evaluators.google.enabled }}
{{- if .Values.app.evaluators.google.credentials.secretKeyRef.name }}
- name: GOOGLE_APPLICATION_CREDENTIALS
  valueFrom:
    secretKeyRef:
      name: {{ .Values.app.evaluators.google.credentials.secretKeyRef.name }}
      key: {{ .Values.app.evaluators.google.credentials.secretKeyRef.key }}
{{- else if .Values.app.evaluators.google.credentials.value }}
- name: GOOGLE_APPLICATION_CREDENTIALS
  value: {{ .Values.app.evaluators.google.credentials.value | quote }}
{{- end }}
{{- end }}

# Telemetry - Usage analytics collection
- name: DISABLE_USAGE_STATS
  value: {{ (not (.Values.app.telemetry.usage.enabled | default true)) | quote }}
# Telemetry - Prometheus metrics collection
{{- if .Values.app.telemetry.metrics.enabled }}
{{- if .Values.app.telemetry.metrics.apiKey.secretKeyRef.name }}
- name: METRICS_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.app.telemetry.metrics.apiKey.secretKeyRef.name }}
      key: {{ .Values.app.telemetry.metrics.apiKey.secretKeyRef.key }}
{{- else if .Values.app.telemetry.metrics.apiKey.value }}
- name: METRICS_API_KEY
  value: {{ .Values.app.telemetry.metrics.apiKey.value | quote }}
{{- end }}
{{- end }}
{{- end }}

{{/* ============================================================ */}}
{{/* Wait-for-ClickHouse init container                            */}}
{{/* ============================================================ */}}


{{/* ============================================================ */}}
{{/* Metrics API Key Helper                                        */}}
{{/* ============================================================ */}}

{{/* Resolve the metrics/telemetry API key from value.
     NOTE: Only .value is supported here because Prometheus bearer_token is a static
     config field in a ConfigMap, not a pod env var. secretKeyRef for the metrics API
     key is handled separately via sharedEnv for the app/worker containers. */}}
{{- define "langwatch.metricsApiKey" -}}
  {{- if .Values.app.telemetry.metrics.apiKey.value -}}
    {{- .Values.app.telemetry.metrics.apiKey.value -}}
  {{- end -}}
{{- end -}}

{{/* ============================================================ */}}
{{/* ClickHouse Helpers                                            */}}
{{/* ============================================================ */}}

{{/* ClickHouse: Password secret name (delegates to subchart naming when chart-managed) */}}
{{- define "langwatch.clickhouse.secretName" -}}
  {{- $chValues := .Values.clickhouse -}}
  {{- if $chValues.auth.existingSecret -}}
    {{- $chValues.auth.existingSecret -}}
  {{- else -}}
    {{- printf "%s-clickhouse" .Release.Name -}}
  {{- end -}}
{{- end -}}

{{/* ClickHouse: Password secret key */}}
{{- define "langwatch.clickhouse.secretKey" -}}
  {{- $chValues := .Values.clickhouse -}}
  {{- if $chValues.auth.existingSecret -}}
    {{- $chValues.auth.secretKeys.passwordKey -}}
  {{- else -}}
    {{- "password" -}}
  {{- end -}}
{{- end -}}

{{/* ============================================================ */}}
{{/* OAuth Provider Env Vars                                      */}}
{{/* ============================================================ */}}

{{/* Map camelCase field names to UPPER_SNAKE env var suffixes */}}
{{- define "langwatch.envSuffix" -}}
  {{- if eq . "clientId" -}}CLIENT_ID
  {{- else if eq . "clientSecret" -}}CLIENT_SECRET
  {{- else if eq . "issuer" -}}ISSUER
  {{- else if eq . "tenantId" -}}TENANT_ID
  {{- end -}}
{{- end -}}

{{/* Emit env var block for a single OAuth field (secretKeyRef or value) */}}
{{/* Args: dict "envName" <string> "fieldValues" <map with .value and .secretKeyRef> */}}
{{- define "langwatch.oauthFieldEnv" -}}
{{- if .fieldValues.secretKeyRef.name }}
- name: {{ .envName }}
  valueFrom:
    secretKeyRef:
      name: {{ .fieldValues.secretKeyRef.name }}
      key: {{ .fieldValues.secretKeyRef.key }}
{{- else if .fieldValues.value }}
- name: {{ .envName }}
  value: {{ .fieldValues.value | quote }}
{{- end }}
{{- end -}}

{{/* ClickHouse: Cluster name for the app (only when replicas > 1 or external.cluster set) */}}
{{- define "langwatch.clickhouse.clusterName" -}}
  {{- if .Values.clickhouse.chartManaged -}}
    {{- $chValues := .Values.clickhouse -}}
    {{- if gt ($chValues.replicas | int) 1 -}}
      {{- "langwatch" -}}
    {{- end -}}
  {{- else -}}
    {{- .Values.clickhouse.external.cluster -}}
  {{- end -}}
{{- end -}}
