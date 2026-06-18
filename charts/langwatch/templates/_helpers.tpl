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

{{/*
  Single primitive for chart-materialised Secret values. Every autogen
  site renders through this helper so a future "all secrets must be
  N-bit / FIPS / Vault-issued" change has one update site instead of
  several. Output: base64-encoded sha256(64-char alphanum), suitable
  for the .data block of a Secret manifest. Callers are responsible
  for idempotency (lookup-then-default) so the value only rolls when
  the existing Secret data is missing.
*/}}
{{- define "langwatch.autogenSecretValue" }}
{{- randAlphaNum 64 | sha256sum | b64enc }}
{{- end }}

{{/*
  Canonical name of the umbrella's app Secret. Resolves to:
    - secrets.existingSecret (operator-provided), else
    - autogen.secretNames.app (when explicitly set), else
    - "langwatch-app-secrets" (fixed default, matches the gateway
      subchart's static `secrets.existingSecretName` default so both
      pods land on the same Secret with zero operator config).
  Used by app/secrets.yaml, app/deployment.yaml, the gateway subchart
  bridge, the preflight Job, and NOTES.txt so every site agrees on the
  one Secret that holds credentialsEncryptionKey + cronApiKey +
  nextAuthSecret + virtualKeyPepper + LW_GATEWAY_INTERNAL_SECRET +
  LW_GATEWAY_JWT_SECRET. this release collapsed the older split (separate
  langwatch-gateway-auth Secret) into this one because there was no
  operational reason to keep them apart and it doubled the
  pre-create-then-install ceremony for operator-managed deployments.

  Why fixed (not release-prefixed): Helm subchart values are literal
  YAML; the gateway subchart's secrets.existingSecretName has to be a
  static string. Picking a fixed name on the parent side means a
  default install works regardless of release name. Operators who
  override secrets.existingSecret OR autogen.secretNames.app must
  also set gateway.secrets.existingSecretName to match — the
  validateSecrets mismatch check below catches that.
*/}}
{{- define "langwatch.appSecretName" -}}
{{- .Values.secrets.existingSecret | default (.Values.autogen.secretNames.app | default "langwatch-app-secrets") -}}
{{- end -}}

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

{{/* Validate AI Gateway virtual-key pepper (control-plane only; never shared with gateway pod) */}}
{{- if .Values.app.virtualKeyPepper.secretKeyRef.name }}
  {{- if empty .Values.app.virtualKeyPepper.secretKeyRef.key }}
    {{- $errors = append $errors "app.virtualKeyPepper.secretKeyRef.name is set but key is empty" }}
  {{- end }}
{{- else if empty .Values.app.virtualKeyPepper.value }}
  {{- if not .Values.autogen.enabled }}
    {{- if empty .Values.secrets.existingSecret }}
      {{- $errors = append $errors "app.virtualKeyPepper must have either value, secretKeyRef, or autogen must be enabled" }}
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

{{/* Validate dataplane storage configuration for stored-objects.
     dataplane.enabled takes precedence over localFilesystem.enabled when
     both are set, so multi-replica is fine as long as dataplane is on.
     Hard-fail: localFilesystem is the active backend AND replicaCount > 1
     (pods don't share a local filesystem, so multi-pod with local-FS is
     guaranteed data loss). Operators who explicitly disable both
     (Neither dataplane.enabled nor localFilesystem.enabled) will fall back
     to the ephemeral writable container layer — fine for tests, lost on
     pod restart. */}}
{{- if and .Values.app.storedObjects.localFilesystem.enabled (not .Values.app.dataplane.enabled) }}
  {{- if gt (int .Values.app.replicaCount) 1 }}
    {{- $errors = append $errors "app.storedObjects.localFilesystem.enabled requires replicaCount=1 (pods don't share a local filesystem). Enable app.dataplane for multi-replica deployments." }}
  {{- end }}
{{- end }}

{{/* Validate dataset storage secrets */}}
{{- if .Values.app.dataplane.enabled }}
  {{- if eq .Values.app.dataplane.provider "awsS3" }}
    {{- if .Values.app.dataplane.providers.awsS3.endpoint.secretKeyRef.name }}
      {{- if empty .Values.app.dataplane.providers.awsS3.endpoint.secretKeyRef.key }}
        {{- $errors = append $errors "app.dataplane.providers.awsS3.endpoint.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
    
    {{- if .Values.app.dataplane.providers.awsS3.accessKeyId.secretKeyRef.name }}
      {{- if empty .Values.app.dataplane.providers.awsS3.accessKeyId.secretKeyRef.key }}
        {{- $errors = append $errors "app.dataplane.providers.awsS3.accessKeyId.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
    
    {{- if .Values.app.dataplane.providers.awsS3.secretAccessKey.secretKeyRef.name }}
      {{- if empty .Values.app.dataplane.providers.awsS3.secretAccessKey.secretKeyRef.key }}
        {{- $errors = append $errors "app.dataplane.providers.awsS3.secretAccessKey.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- end }}
    
    {{- if .Values.app.dataplane.providers.awsS3.keySalt.secretKeyRef.name }}
      {{- if empty .Values.app.dataplane.providers.awsS3.keySalt.secretKeyRef.key }}
        {{- $errors = append $errors "app.dataplane.providers.awsS3.keySalt.secretKeyRef.name is set but key is empty" }}
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
  {{/* Gate the chart-managed ClickHouse Secret on autogen.enabled, same shape
       as app-secrets / gateway-auth. When autogen=true the chart materialises
       it via per-key lookup-or-rand. When autogen=false the operator owns
       the Secret out-of-band and MUST set clickhouse.auth.existingSecret to a
       name different from the default <release>-clickhouse — the deployment's
       runtime CLICKHOUSE_URL composition only kicks in for the override path,
       so the default-named case requires the chart-managed url-secret to
       still render. */}}
  {{- $chSecretName := include "langwatch.clickhouse.secretName" . }}
  {{- $chDefaultName := printf "%s-clickhouse" .Release.Name }}
  {{- if and (not .Values.autogen.enabled) (eq $chSecretName $chDefaultName) }}
    {{- $errors = append $errors (printf "clickhouse.chartManaged=true with autogen.enabled=false requires clickhouse.auth.existingSecret to be set to an operator-owned Secret name different from the default %q. The deployment composes CLICKHOUSE_URL at runtime from the password key when a custom name is used; with the default name the deployment expects the chart-rendered url key, which is gated off when autogen.enabled=false. Either set autogen.enabled=true OR override clickhouse.auth.existingSecret." $chDefaultName) }}
  {{- end }}
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

{{/* Validate AI Gateway secret wiring.

     this release collapsed the separate langwatch-gateway-auth Secret into
     the umbrella's app Secret: both langwatch-app and the gateway pod
     mount LW_GATEWAY_INTERNAL_SECRET + LW_GATEWAY_JWT_SECRET from the
     same Secret that holds credentialsEncryptionKey / cronApiKey /
     nextAuthSecret / virtualKeyPepper. So the existing
     `autogen is disabled but no existingSecret is provided` check
     above already covers the gateway case — when chartManaged is on,
     the same Secret either materialises via autogen or the operator
     provides it via secrets.existingSecret.

     What we DO still validate: the umbrella's app deployment resolves
     the app-secret name dynamically via `langwatch.appSecretName`, but
     the gateway subchart can only receive a STATIC value via
     gateway.secrets.existingSecretName (Helm subchart values are
     literal YAML, not templated). When the operator overrides
     secrets.existingSecret OR autogen.secretNames.app (or runs with
     a non-default release name), they MUST also set
     gateway.secrets.existingSecretName to the same Secret name — else
     the app reads from one Secret and the gateway pod mounts another
     and both crashloop with CreateContainerConfigError.

     We do NOT validate gateway.otel.* auth here. The gateway subchart
     deployment template (charts/gateway/templates/deployment.yaml)
     intentionally does NOT inject GATEWAY_OTEL_DEFAULT_AUTH_TOKEN
     (forward-compat-only knob), so failing on absent values would
     tell operators to set knobs that do not actually authenticate
     the OTLP export. The mitigation for the postmortem's Bifrost
     recursion trigger is the chart default flipped to
     gateway.otel.endpoint="". Operators who opt back in plumb the
     header via gateway.extraEnvs (OTEL_OTLP_HEADERS) until the
     subchart wires the knobs natively. */}}
{{- $gw := .Values.gateway | default dict }}
{{- if $gw.chartManaged }}
  {{- $gwSecrets := $gw.secrets | default dict }}
  {{- $gwSecretName := $gwSecrets.existingSecretName | default "" }}
  {{- $appSecretName := include "langwatch.appSecretName" . }}
  {{- if ne $gwSecretName $appSecretName }}
    {{- $errors = append $errors (printf "gateway.secrets.existingSecretName (%q) must equal the app Secret name (%q). this release collapsed gateway-auth into the app Secret so both langwatch-app and the gateway pod mount the same Secret. Either drop the secrets.existingSecret / autogen.secretNames.app override to use the langwatch-app-secrets default, or set gateway.secrets.existingSecretName to %q so both pods agree." $gwSecretName $appSecretName $appSecretName) }}
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
{{- $chSecretName := include "langwatch.clickhouse.secretName" . }}
{{- $chDefaultName := printf "%s-clickhouse" .Release.Name }}
{{- if eq $chSecretName $chDefaultName }}
{{/* Langwatch-owned secret — URL is stored as a secret key */}}
- name: CLICKHOUSE_URL
  valueFrom:
    secretKeyRef:
      name: {{ $chSecretName }}
      key: url
{{- else }}
{{/* User-provided existingSecret — construct URL from password at runtime */}}
- name: CLICKHOUSE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ $chSecretName }}
      key: {{ include "langwatch.clickhouse.secretKey" . }}
- name: CLICKHOUSE_URL
  value: "http://default:$(CLICKHOUSE_PASSWORD)@{{ .Release.Name }}-clickhouse:8123/langwatch"
{{- end }}
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
      name: {{ include "langwatch.appSecretName" . }}
      key: credentialsEncryptionKey
{{- end }}

# Evaluators - Azure OpenAI Integration
{{- if .Values.app.evaluators.azureOpenAI.enabled }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_OPENAI_ENDPOINT" "fieldValues" .Values.app.evaluators.azureOpenAI.endpoint) }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_OPENAI_KEY" "fieldValues" .Values.app.evaluators.azureOpenAI.apiKey) }}
{{- end }}

# Evaluators - Google AI Integration
{{- if .Values.app.evaluators.google.enabled }}
{{- include "langwatch.secretOrValue" (dict "envName" "GOOGLE_APPLICATION_CREDENTIALS" "fieldValues" .Values.app.evaluators.google.credentials) }}
{{- end }}

# Telemetry - Usage analytics collection
- name: DISABLE_USAGE_STATS
  value: {{ (not (ternary .Values.app.telemetry.usage.enabled true (hasKey .Values.app.telemetry.usage "enabled"))) | quote }}
# Telemetry - Prometheus metrics collection
{{- if .Values.app.telemetry.metrics.enabled }}
{{- include "langwatch.secretOrValue" (dict "envName" "METRICS_API_KEY" "fieldValues" .Values.app.telemetry.metrics.apiKey) }}
{{- end }}

# Dataplane Object Storage (shared between datasets and stored-objects;
# emitted under the legacy `dataplane` value key for
# backwards compatibility — bucket carries BOTH dataset uploads and
# externalized scenario media in this release).
{{- if .Values.app.dataplane.enabled }}
- name: USE_S3_STORAGE
  value: "true"
# Emit S3_BUCKET_NAME — the app/server reads this name across all
# storage code paths (storage.ts, stored-objects.service.ts,
# env-create.mjs). The legacy `S3_BUCKET` env was a no-op for every
# vanilla helm install because nothing read it; emitting it was a
# silent bug that this fix resolves by aligning on S3_BUCKET_NAME.
- name: S3_BUCKET_NAME
  value: {{ .Values.app.dataplane.bucket | quote }}
{{- if eq .Values.app.dataplane.provider "awsS3" }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_ENDPOINT" "fieldValues" .Values.app.dataplane.providers.awsS3.endpoint) }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_ACCESS_KEY_ID" "fieldValues" .Values.app.dataplane.providers.awsS3.accessKeyId) }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_SECRET_ACCESS_KEY" "fieldValues" .Values.app.dataplane.providers.awsS3.secretAccessKey) }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_KEY_SALT" "fieldValues" .Values.app.dataplane.providers.awsS3.keySalt) }}
{{- end }}
{{- else if .Values.app.storedObjects.localFilesystem.enabled }}
# Single-replica local-filesystem fallback for stored-objects. ONLY safe
# when replicaCount == 1 because pods don't share a filesystem; a
# multi-pod deployment will end up with each pod able to read only the
# subset of files it personally wrote. The chart enforces the single
# replica constraint via a validation rule and the PVC is RWO by
# default. NOT for production. Operators who need multi-replica MUST
# enable dataplane with a real object-storage backend.
- name: LANGWATCH_LOCAL_STORAGE_PATH
  value: {{ .Values.app.storedObjects.localFilesystem.path | quote }}
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

{{/* ClickHouse: Secret name — langwatch chart owns the secret (passed to subchart via auth.existingSecret) */}}
{{- define "langwatch.clickhouse.secretName" -}}
  {{- if .Values.clickhouse.auth.existingSecret -}}
    {{- tpl .Values.clickhouse.auth.existingSecret . -}}
  {{- else -}}
    {{- printf "%s-clickhouse" .Release.Name -}}
  {{- end -}}
{{- end -}}

{{/* ClickHouse: Password secret key */}}
{{- define "langwatch.clickhouse.secretKey" -}}
  {{- .Values.clickhouse.auth.secretKeys.passwordKey | default "password" -}}
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

{{/* Emit env var block: secretKeyRef takes precedence, then .value */}}
{{/* Args: dict "envName" <string> "fieldValues" <map with .value and .secretKeyRef> */}}
{{- define "langwatch.secretOrValue" -}}
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

{{/*
  Returns "true" when the local-filesystem driver is the ACTIVE stored-objects
  backend (and therefore needs the PVC + volume mount), or empty string when
  it isn't and the PVC must NOT render.

  "Active" means `app.storedObjects.localFilesystem.enabled` is true AND
  `app.dataplane.enabled` is false. When dataplane is enabled, S3/Azure is the
  active backend even if localFilesystem.enabled is still true (the value can
  be on by default — that's intentional for single-replica fallbacks — but
  must NOT cause the chart to mount an RWO PVC into multiple replicas).

  Used by:
    - templates/app/stored-objects-pvc.yaml (gates PVC creation)
    - templates/app/deployment.yaml         (gates volume + mount)

  Without this helper, `--set app.replicaCount=2 --set app.dataplane.enabled=true`
  would still create the RWO PVC and mount it into multiple replicas — only
  one would attach, the others crash-loop (Sergio review 2026-05-20).
*/}}
{{- define "langwatch.storedObjects.localFilesystemIsActive" -}}
{{- if and .Values.app.storedObjects.localFilesystem.enabled (not .Values.app.dataplane.enabled) -}}
true
{{- end -}}
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
