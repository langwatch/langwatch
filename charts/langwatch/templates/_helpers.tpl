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
  {{- $replicas := .Values.clickhouse.managed.replicas | int }}
  {{- if and (gt $replicas 1) (eq (mod $replicas 2) 0) }}
    {{- $errors = append $errors "clickhouse.managed.replicas must be odd (1, 3, 5, 7) for Keeper quorum" }}
  {{- end }}
  {{- if and (empty .Values.clickhouse.auth.password) (empty .Values.clickhouse.auth.existingSecret) (not .Values.autogen.enabled) }}
    {{- $errors = append $errors "clickhouse.auth.password, clickhouse.auth.existingSecret, or autogen must be configured" }}
  {{- end }}
  {{- if .Values.clickhouse.managed.cold.enabled }}
    {{- if empty .Values.clickhouse.managed.cold.bucket }}
      {{- $errors = append $errors "clickhouse.managed.cold.enabled is true but cold.bucket is not configured" }}
    {{- end }}
  {{- end }}
{{- end }}

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
{{- else}}
  {{- if and (empty .Values.postgresql.auth.password) (empty .Values.postgresql.auth.existingSecret) (not .Values.autogen.enabled) }}
    {{- $errors = append $errors "neither postgresql.auth.password nor postgresql.auth.existingSecret is configured (enable autogen or provide one)" }}
  {{- end }}
{{- end }}

{{- if not .Values.prometheus.chartManaged }}
  {{- if .Values.prometheus.external.existingSecret }}
    {{- if empty .Values.prometheus.external.secretKeys.host }}
      {{- $errors = append $errors "prometheus.external.existingSecret is set but secretKeys.host is not configured" }}
    {{- end }}
    {{- if empty .Values.prometheus.external.secretKeys.port }}
      {{- $errors = append $errors "prometheus.external.existingSecret is set but secretKeys.port is not configured" }}
    {{- end }}
  {{- else }}
    {{- $errors = append $errors "prometheus.chartManaged is false but external.existingSecret is not configured" }}
  {{- end }}
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
{{/* Metrics API Key Helper                                        */}}
{{/* ============================================================ */}}

{{/* Resolve the metrics/telemetry API key from value or secretKeyRef */}}
{{- define "langwatch.metricsApiKey" -}}
  {{- if .Values.app.telemetry.metrics.apiKey.value -}}
    {{- .Values.app.telemetry.metrics.apiKey.value -}}
  {{- end -}}
{{- end -}}

{{/* ============================================================ */}}
{{/* ClickHouse Derivation Helpers                                 */}}
{{/* ============================================================ */}}

{{/* ClickHouse: Convert memory string (e.g. "4Gi", "512Mi") to bytes */}}
{{- define "langwatch.clickhouse.memoryBytes" -}}
  {{- $mem := .Values.clickhouse.managed.memory | toString -}}
  {{- if hasSuffix "Gi" $mem -}}
    {{- $val := trimSuffix "Gi" $mem | float64 -}}
    {{- printf "%.0f" (mulf $val 1073741824.0) -}}
  {{- else if hasSuffix "Mi" $mem -}}
    {{- $val := trimSuffix "Mi" $mem | float64 -}}
    {{- printf "%.0f" (mulf $val 1048576.0) -}}
  {{- else -}}
    {{- $mem -}}
  {{- end -}}
{{- end -}}

{{/* ClickHouse: MAX_SERVER_MEMORY_USAGE = 85% of pod memory */}}
{{- define "langwatch.clickhouse.maxServerMemoryUsage" -}}
  {{- $bytes := include "langwatch.clickhouse.memoryBytes" . | float64 -}}
  {{- printf "%.0f" (mulf $bytes 0.85) -}}
{{- end -}}

{{/* ClickHouse: MAX_MEMORY_USAGE_PER_QUERY = 20% of pod memory */}}
{{- define "langwatch.clickhouse.maxMemoryUsagePerQuery" -}}
  {{- $bytes := include "langwatch.clickhouse.memoryBytes" . | float64 -}}
  {{- printf "%.0f" (mulf $bytes 0.20) -}}
{{- end -}}

{{/* ClickHouse: MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY = 10% of pod memory */}}
{{- define "langwatch.clickhouse.maxBytesBeforeExternalGroupBy" -}}
  {{- $bytes := include "langwatch.clickhouse.memoryBytes" . | float64 -}}
  {{- printf "%.0f" (mulf $bytes 0.10) -}}
{{- end -}}

{{/* ClickHouse: MAX_BYTES_BEFORE_EXTERNAL_SORT = 10% of pod memory */}}
{{- define "langwatch.clickhouse.maxBytesBeforeExternalSort" -}}
  {{- $bytes := include "langwatch.clickhouse.memoryBytes" . | float64 -}}
  {{- printf "%.0f" (mulf $bytes 0.10) -}}
{{- end -}}

{{/* ClickHouse: UNCOMPRESSED_CACHE_SIZE = 12% of pod memory */}}
{{- define "langwatch.clickhouse.uncompressedCacheSize" -}}
  {{- $bytes := include "langwatch.clickhouse.memoryBytes" . | float64 -}}
  {{- printf "%.0f" (mulf $bytes 0.12) -}}
{{- end -}}

{{/* ClickHouse: BACKGROUND_POOL_SIZE = max(1, floor(cpu / 2)) */}}
{{- define "langwatch.clickhouse.backgroundPoolSize" -}}
  {{- $cpu := .Values.clickhouse.managed.cpu | int -}}
  {{- $val := div $cpu 2 -}}
  {{- if lt $val 1 }}1{{- else }}{{ $val }}{{- end -}}
{{- end -}}

{{/* ClickHouse: MAX_INSERT_THREADS = max(1, floor(cpu / 4)) */}}
{{- define "langwatch.clickhouse.maxInsertThreads" -}}
  {{- $cpu := .Values.clickhouse.managed.cpu | int -}}
  {{- $val := div $cpu 4 -}}
  {{- if lt $val 1 }}1{{- else }}{{ $val }}{{- end -}}
{{- end -}}

{{/* ClickHouse: MAX_CONCURRENT_QUERIES = min(100, cpu * 25) */}}
{{- define "langwatch.clickhouse.maxConcurrentQueries" -}}
  {{- $cpu := .Values.clickhouse.managed.cpu | int -}}
  {{- $val := mul $cpu 25 -}}
  {{- if gt $val 100 }}100{{- else }}{{ $val }}{{- end -}}
{{- end -}}

{{/* ClickHouse: Password secret name */}}
{{- define "langwatch.clickhouse.secretName" -}}
  {{- if .Values.clickhouse.auth.existingSecret -}}
    {{- .Values.clickhouse.auth.existingSecret -}}
  {{- else -}}
    {{- printf "%s-clickhouse" .Release.Name -}}
  {{- end -}}
{{- end -}}

{{/* ClickHouse: Password secret key */}}
{{- define "langwatch.clickhouse.secretKey" -}}
  {{- if .Values.clickhouse.auth.existingSecret -}}
    {{- .Values.clickhouse.auth.secretKeys.passwordKey -}}
  {{- else -}}
    {{- "password" -}}
  {{- end -}}
{{- end -}}

{{/* ClickHouse: Cluster name for the app (only when replicas > 1 or external.cluster set) */}}
{{- define "langwatch.clickhouse.clusterName" -}}
  {{- if .Values.clickhouse.chartManaged -}}
    {{- if gt (int .Values.clickhouse.managed.replicas) 1 -}}
      langwatch
    {{- end -}}
  {{- else -}}
    {{- .Values.clickhouse.external.cluster -}}
  {{- end -}}
{{- end -}}
