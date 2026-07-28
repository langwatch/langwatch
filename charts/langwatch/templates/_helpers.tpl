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

{{/*
  LW_GATEWAY_BASE_URL env entry for the pods that talk to the gateway from
  inside the cluster (the app and the workers, which both resolve Langy's
  credentials). Renders nothing when there is no gateway to point at.

  gateway.internalUrl wins for non-standard topologies (a gateway run outside
  this release, a service mesh address). Otherwise it is the Service this chart
  renders, whose name follows the release like the other sibling Services and
  whose port comes from the subchart's own value so the two cannot drift.
*/}}
{{- define "langwatch.gatewayBaseUrlEnv" -}}
{{- $gw := .Values.gateway | default dict }}
{{- $url := $gw.internalUrl | default "" }}
{{- if and (not $url) $gw.chartManaged }}
{{- $port := (($gw.service) | default dict).port | default 80 }}
{{- $url = printf "http://%s-gateway:%v" .Release.Name $port }}
{{- end }}
{{- if $url }}
- name: LW_GATEWAY_BASE_URL
  value: {{ $url | quote }}
{{- end }}
{{- end -}}

{{/*
  LANGY_WORKER_CALLBACK_URL env entry — the origin the Langy agent's workers dial
  back on: the relay frame push, the durable turn finalize, the session-key
  revoke, and the LANGWATCH_ENDPOINT the langwatch CLI uses for every tool call.

  Without it the app hands the worker its own PUBLIC base URL, which is the
  wrong address for a pod on the same cluster to use. At best the traffic
  leaves the cluster and comes back; at worst that hostname means something
  else entirely inside the pod, and every callback fails while the model calls
  keep succeeding — a turn that costs tokens, produces an answer, and then
  never delivers it.

  langyagent.controlPlane.callbackUrl overrides it for split topologies.
*/}}
{{- define "langwatch.langyCallbackUrlEnv" -}}
{{- $langy := (index .Values "langyagent") | default dict }}
{{- $cp := $langy.controlPlane | default dict }}
{{- $url := $cp.callbackUrl | default "" }}
{{- if not $url }}
{{- $port := ((.Values.app).service | default dict).port | default 5560 }}
{{- $url = printf "http://%s-app:%v" .Release.Name $port }}
{{- end }}
- name: LANGY_WORKER_CALLBACK_URL
  value: {{ $url | quote }}
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
  {{- /* Workers mount the SAME RWO PVC as the app, so they are bound by the
         same single-node constraint — guard workers.replicaCount too, else a
         multi-replica worker pool renders cleanly then crashloops on the volume.
         Only when workers are actually deployed: a disabled worker pool's
         leftover replicaCount must not fail the render. */}}
  {{- if and .Values.workers.enabled (gt (int .Values.workers.replicaCount) 1) }}
    {{- $errors = append $errors "app.storedObjects.localFilesystem.enabled requires workers.replicaCount=1 (workers share the app's local-filesystem PVC). Enable app.dataplane for multi-replica deployments." }}
  {{- end }}
{{- end }}

{{/* Validate dataset storage secrets */}}
{{- if .Values.app.dataplane.enabled }}
  {{/* A provider name outside this set silently configures NOTHING: no
       credentials are emitted, no validation runs, and the app falls through
       to whatever STORED_OBJECTS_BACKEND says — so a typo would look like a
       working install until the first write. Reject it here instead. */}}
  {{- if not (has .Values.app.dataplane.provider (list "awsS3" "azureBlob")) }}
    {{- $errors = append $errors (printf "app.dataplane.provider is %q — must be one of awsS3, azureBlob" .Values.app.dataplane.provider) }}
  {{- end }}
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
  {{- else if eq .Values.app.dataplane.provider "azureBlob" }}
    {{- if .Values.app.dataplane.providers.azureBlob.accountName.secretKeyRef.name }}
      {{- if empty .Values.app.dataplane.providers.azureBlob.accountName.secretKeyRef.key }}
        {{- $errors = append $errors "app.dataplane.providers.azureBlob.accountName.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- else if empty .Values.app.dataplane.providers.azureBlob.accountName.value }}
      {{- $errors = append $errors "app.dataplane.provider is azureBlob but providers.azureBlob.accountName is not configured" }}
    {{- end }}

    {{- $azureAuthMode := .Values.app.dataplane.providers.azureBlob.authMode | default "sharedKey" }}
    {{- if not (has $azureAuthMode (list "sharedKey" "workloadIdentity" "managedIdentity" "azureCli")) }}
      {{- $errors = append $errors (printf "app.dataplane.providers.azureBlob.authMode is %q — must be one of sharedKey, workloadIdentity, managedIdentity, azureCli" $azureAuthMode) }}
    {{- end }}
    {{/* The account key is required by, and only by, sharedKey auth. Under an
         identity mode it must be absent — a key that would be silently ignored
         is worse than no key, because the operator believes it is in use. */}}
    {{- if eq $azureAuthMode "sharedKey" }}
      {{- if .Values.app.dataplane.providers.azureBlob.accountKey.secretKeyRef.name }}
        {{- if empty .Values.app.dataplane.providers.azureBlob.accountKey.secretKeyRef.key }}
          {{- $errors = append $errors "app.dataplane.providers.azureBlob.accountKey.secretKeyRef.name is set but key is empty" }}
        {{- end }}
      {{- else if empty .Values.app.dataplane.providers.azureBlob.accountKey.value }}
        {{- $errors = append $errors "app.dataplane.provider is azureBlob with authMode sharedKey but providers.azureBlob.accountKey is not configured" }}
      {{- end }}
    {{- else }}
      {{- if or .Values.app.dataplane.providers.azureBlob.accountKey.value .Values.app.dataplane.providers.azureBlob.accountKey.secretKeyRef.name }}
        {{- $errors = append $errors (printf "app.dataplane.providers.azureBlob.authMode is %q but providers.azureBlob.accountKey is also configured — remove the key, it would be ignored" $azureAuthMode) }}
      {{- end }}
      {{/* The app refuses a non-public endpoint in a token mode without a
           matching identity authority (it would otherwise ask the
           public-cloud issuer for a sovereign token). Mirror that here so a
           sovereign install fails at deploy time rather than on the first
           write, when the chart would otherwise have rendered green. */}}
      {{- $azureEndpoint := .Values.app.dataplane.providers.azureBlob.endpoint.value }}
      {{- if and $azureEndpoint (not (contains ".blob.core.windows.net" $azureEndpoint)) }}
        {{- if not (or .Values.app.dataplane.providers.azureBlob.authorityHost.value .Values.app.dataplane.providers.azureBlob.authorityHost.secretKeyRef.name) }}
          {{- $errors = append $errors (printf "app.dataplane.providers.azureBlob.endpoint is %q, which is not the Azure public cloud — a token-based authMode also requires providers.azureBlob.authorityHost so tokens are requested from the matching identity authority" $azureEndpoint) }}
        {{- end }}
      {{- end }}
      {{- if eq $azureAuthMode "workloadIdentity" }}
        {{- if not (include "langwatch.serviceAccountName" .) }}
          {{- $errors = append $errors "azureBlob authMode workloadIdentity requires global.serviceAccount (create=true or name) so the Entra identity has a ServiceAccount to bind to" }}
        {{- end }}
      {{- end }}
    {{- end }}

    {{- if .Values.app.dataplane.providers.azureBlob.container.secretKeyRef.name }}
      {{- if empty .Values.app.dataplane.providers.azureBlob.container.secretKeyRef.key }}
        {{- $errors = append $errors "app.dataplane.providers.azureBlob.container.secretKeyRef.name is set but key is empty" }}
      {{- end }}
    {{- else if empty .Values.app.dataplane.providers.azureBlob.container.value }}
      {{- $errors = append $errors "app.dataplane.provider is azureBlob but providers.azureBlob.container is not configured" }}
    {{- end }}
  {{- end }}
{{- end }}

{{/* Validate email provider secrets. Whether a gateway is configured at all is
     langwatch.emailProviderGuard's job; this only catches a half-written
     secret reference, which names a Secret but no key inside it. That reads as
     configured to the guard and resolves to nothing at the container, so
     without this it survives install and fails at the first send.

     Only the selected gateway is checked, since no other gateway's settings
     are rendered. */}}
{{- $emailSecretRefs := dict
      "sendgrid" (list (dict "path" "sendgrid.apiKey" "ref" .Values.app.email.providers.sendgrid.apiKey.secretKeyRef))
      "resend"   (list (dict "path" "resend.apiKey"   "ref" .Values.app.email.providers.resend.apiKey.secretKeyRef))
      "smtp"     (list (dict "path" "smtp.url"        "ref" .Values.app.email.providers.smtp.url.secretKeyRef)
                       (dict "path" "smtp.password"   "ref" .Values.app.email.providers.smtp.password.secretKeyRef)) }}
{{- range $field := (get $emailSecretRefs .Values.app.email.provider | default list) }}
  {{- if and $field.ref.name (empty $field.ref.key) }}
    {{- $errors = append $errors (printf "app.email.providers.%s.secretKeyRef.name is set but key is empty" $field.path) }}
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

  {{/* The gateway derives its route to the control plane as
       `<release>-app:5560` when nothing is set. The release half always
       matches, since the app Service is named after it. The port half is a
       constant the subchart cannot see past, so an app moved to another port
       would leave the gateway dialling a closed one — a install that comes up
       entirely healthy and then refuses every request that carries a virtual
       key. Stop instead, and name the value that fixes it. */}}
  {{- $gwBaseUrl := (($gw.controlPlane) | default dict).baseUrl | default "" }}
  {{- $appPort := ((.Values.app.service) | default dict).port | default 5560 }}
  {{- if and (not $gwBaseUrl) (ne (int $appPort) 5560) }}
    {{- $errors = append $errors (printf "app.service.port is %v, but the gateway works out where the control plane is on its own and can only assume the default port 5560. It would dial http://%s-app:5560 and get nothing, and the install would come up healthy while refusing every request that carries a virtual key. Set gateway.controlPlane.baseUrl to http://%s-app:%v." $appPort .Release.Name .Release.Name $appPort) }}
  {{- end }}
{{- end }}

{{/* Validate Langy agent secret wiring.

     Unlike the gateway, all three Langy consumers (app, workers, agent pod)
     read the SAME langyagent.secrets.* values, so they cannot disagree with
     each other and no name-match check is needed.

     What can still go wrong: the chart materialises LANGY_INTERNAL_SECRET
     into its own app Secret, which it only writes when autogen is on. An
     operator who brings their own Secret (autogen off, or a Secret managed by
     terraform / external-secrets) has to carry the key themselves, and the
     failure mode without this check is three pods in
     CreateContainerConfigError naming a key nothing told them to add.

     `lookup` returns empty during `helm template` and on a dry run, so this
     fires only against a real cluster, and only when the Secret is already
     there and demonstrably missing the key — never on a first install where
     it has yet to be created. */}}
{{- $langy := (index .Values "langyagent") | default dict }}
{{- if $langy.chartManaged }}
  {{- $langySecrets := $langy.secrets | default dict }}
  {{- $langySecretName := $langySecrets.existingSecretName | default (include "langwatch.appSecretName" .) }}
  {{- $langyKey := $langySecrets.internalSecretKey | default "LANGY_INTERNAL_SECRET" }}
  {{/* Subchart values are literal YAML, so langyagent.secrets.existingSecretName
       is a static string while the app Secret's name resolves dynamically. An
       operator who renames the app Secret and leaves this at its stock default
       sends all three pods to a Secret that no longer exists. Pointing Langy at
       a genuinely different Secret stays legitimate (external-secrets,
       terraform); only the untouched default is treated as an oversight. */}}
  {{- $appSecretName := include "langwatch.appSecretName" . }}
  {{- if and (ne $appSecretName "langwatch-app-secrets") (eq ($langySecrets.existingSecretName | default "") "langwatch-app-secrets") }}
    {{- $errors = append $errors (printf "langyagent.secrets.existingSecretName is still the default %q but the app Secret is named %q. The app, the workers, and the agent pod would all mount a Secret this install does not have. Set langyagent.secrets.existingSecretName to %q, or to whichever Secret holds %s (the same mirroring the gateway subchart needs). To run without the Langy assistant instead, set langyagent.chartManaged=false." "langwatch-app-secrets" $appSecretName $appSecretName $langyKey) }}
  {{- end }}
  {{/* A configured key that collides with one of the app Secret's own keys would
       emit the same Secret.data entry twice, and the second write wins — Langy's
       random value would silently become the session secret or the gateway
       token. Refuse rather than quietly conflating two credentials whose blast
       radii are meant to be separate. Only when both live in the same Secret;
       an operator-owned Secret elsewhere may name its key whatever it likes. */}}
  {{- if eq $langySecretName (include "langwatch.appSecretName" .) }}
    {{- $reserved := list "credentialsEncryptionKey" "cronApiKey" "nextAuthSecret" "virtualKeyPepper" }}
    {{- if (.Values.gateway).chartManaged }}
      {{- $reserved = concat $reserved (list "LW_GATEWAY_INTERNAL_SECRET" "LW_GATEWAY_JWT_SECRET") }}
    {{- end }}
    {{- if has $langyKey $reserved }}
      {{- $errors = append $errors (printf "langyagent.secrets.internalSecretKey is %q, which is already a key of the app Secret %q. Langy would overwrite that credential with its own value. Pick a distinct key name (the default is LANGY_INTERNAL_SECRET), or point langyagent.secrets.existingSecretName at a separate Secret." $langyKey $langySecretName) }}
    {{- end }}
  {{- end }}
  {{- $chartWritesIt := and .Values.autogen.enabled (empty .Values.secrets.existingSecret) (eq $langySecretName (include "langwatch.appSecretName" .)) }}
  {{- if not $chartWritesIt }}
    {{- $found := lookup "v1" "Secret" .Release.Namespace $langySecretName }}
    {{- $hint := printf "Either add the key to that Secret (kubectl -n %s create secret generic %s --from-literal=%s=$(openssl rand -hex 32), or patch it if it already exists), point langyagent.secrets.existingSecretName at the Secret that does hold it, or let the chart generate it by leaving autogen.enabled=true with no secrets.existingSecret override." .Release.Namespace $langySecretName $langyKey }}
    {{- if not $found }}
      {{/* Every lookup comes back empty during `helm template` and dry runs, so
           "Secret not found" there means "we cannot see the cluster", not "it is
           missing". Probe with an object every real cluster has: if kube-system
           is invisible too, stay quiet rather than failing a plain render. */}}
      {{- if lookup "v1" "Namespace" "" "kube-system" }}
        {{- $errors = append $errors (printf "Langy is enabled (langyagent.chartManaged=true) but Secret %q was not found in namespace %q, and this chart is not generating it. The app, the workers, and the agent pod all read %q from it to authenticate to each other, so all three would start into CreateContainerConfigError. %s" $langySecretName .Release.Namespace $langyKey $hint) }}
      {{- end }}
    {{- else if not (index ($found.data | default dict) $langyKey) }}
      {{- $errors = append $errors (printf "Langy is enabled (langyagent.chartManaged=true) but Secret %q in namespace %q has no %q key. The app, the workers, and the agent pod all read that one key to authenticate to each other. %s" $langySecretName .Release.Namespace $langyKey $hint) }}
    {{- end }}
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
{{/* Email provider guard                                          */}}
{{/* ============================================================ */}}

{{/* Fail the render when app.email.provider names a gateway that nothing
     configures. The app treats EMAIL_PROVIDER as authoritative and never falls
     back to another gateway, so without this the mistake surfaces at the first
     alert instead of at install time.

     Skipped when extraEnvs or extraEnvFrom are in play: those can carry the
     provider's settings (an SMTP_URL from a pre-existing Secret, AWS_REGION
     alongside IRSA credentials) and the chart cannot see inside them. They
     reach one Deployment each, though, while the gateway is shared by both, so
     every Deployment that sends email has to have a source of its own for the
     bypass to hold. */}}
{{- define "langwatch.emailProviderGuard" -}}
{{- if hasKey .Values.app.email "enabled" }}
{{- fail "app.email.enabled no longer exists: naming app.email.provider is what turns email on. Set app.email.provider to sendgrid, ses, smtp or resend and remove app.email.enabled." }}
{{- end }}
{{- $provider := .Values.app.email.provider }}
{{- if $provider }}
{{- $providers := .Values.app.email.providers }}
{{- $configured := dict
      "sendgrid" (or $providers.sendgrid.apiKey.value $providers.sendgrid.apiKey.secretKeyRef.name)
      "resend"   (or $providers.resend.apiKey.value $providers.resend.apiKey.secretKeyRef.name)
      "smtp"     (or $providers.smtp.url.value $providers.smtp.url.secretKeyRef.name $providers.smtp.host)
      "ses"      $providers.ses.region }}
{{- if not (hasKey $configured $provider) }}
{{- fail (printf "app.email.provider is %q, which is not one of: sendgrid, ses, smtp, resend." $provider) }}
{{- end }}
{{- if not (get $configured $provider) }}
{{- $needed := list }}
{{- if not (or .Values.app.extraEnvs .Values.app.extraEnvFrom) }}
{{- $needed = append $needed "app.extraEnvs / app.extraEnvFrom" }}
{{- end }}
{{- if and .Values.workers.enabled (not (or .Values.workers.extraEnvs .Values.workers.extraEnvFrom)) }}
{{- $needed = append $needed "workers.extraEnvs / workers.extraEnvFrom" }}
{{- end }}
{{- if $needed }}
{{- fail (printf "app.email.provider is %q, but app.email.providers.%s is empty. Configure it, pick another provider, or supply its settings through %s. The web application sends invitations and password resets, the workers send scheduled reports and alert notifications, and each Deployment reads only its own extra environment." $provider $provider (join " and " $needed)) }}
{{- end }}
{{- end }}
{{- end }}
{{- end -}}

{{/* ============================================================ */}}
{{/* Shared Environment Variables                                  */}}
{{/* ============================================================ */}}
{{/* Common env vars shared between app and workers deployments */}}

{{- define "langwatch.sharedEnv" }}
- name: NODE_ENV
  value: {{ .Values.app.nodeEnv | default .Values.global.env | default "production" }}

- name: BASE_HOST
  value: {{ .Values.app.http.baseHost | default "http://localhost:5560" }}

{{/* The address this installation answers on, and the one BetterAuth measures
     every callback, redirect and same-origin check against. Shared rather than
     app-only: the auth module is imported wherever the app code is, so a
     workers or cronjob process without it boots into
     "[better-auth] Base URL could not be determined" and builds its links off
     nothing. Same value everywhere, so no process can disagree with another
     about what this installation is called. */}}
- name: NEXTAUTH_URL
  value: {{ .Values.app.http.publicUrl | default .Values.app.http.baseHost | default "http://localhost:5560" }}

- name: SKIP_ENV_VALIDATION
  value: {{ .Values.app.features.skipEnvValidation | default false | quote }}
{{- if .Values.app.features.disableStrictPiiRedaction }}
- name: OPS_PII_STRICT_PRESIDIO_REDACTION_DISABLED
  value: "1"
{{- end }}

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
{{/* Backup-status gauges (system.backup_log) are opt-in — the app/worker only
     queries the backup log when CLICKHOUSE_BACKUP_METRICS_ENABLED=true. Couple
     that to the backup config so the "Backup Reporting Absent" signal can never
     drift from whether backups actually run: on whenever chart-managed backups
     are enabled, or when an operator forces it for out-of-band backups. */}}
{{- $chBackup := (.Values.clickhouse).backup }}
{{- if or ($chBackup).enabled ($chBackup).metricsEnabled }}
- name: CLICKHOUSE_BACKUP_METRICS_ENABLED
  value: "true"
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
# backwards compatibility — the bucket/container carries BOTH dataset
# uploads and externalized scenario media in this release).
{{- if .Values.app.dataplane.enabled }}
{{- if eq .Values.app.dataplane.provider "azureBlob" }}
# Azure Blob backend (AC37, issue #4133). STORED_OBJECTS_BACKEND is the
# EXPLICIT toggle resolveProjectStorageDestination reads — AZURE_BLOB_* env
# presence alone never selects this backend, only this value does, which is
# why the connection settings below can outlive it (see legacyAzureRead).
- name: STORED_OBJECTS_BACKEND
  value: "azure"
{{- end }}
{{/* Azure connection settings are emitted when Azure is the active write
     backend OR when legacyAzureRead is set for an Azure->S3 migration. The
     app's driver registration resolves these for READS independently of the
     write toggle, so keeping them after the switch is what lets already
     written azure-blob:// objects stay readable — the mirror of
     legacyS3ReadBucket in the other direction. */}}
{{- if or (eq .Values.app.dataplane.provider "azureBlob") .Values.app.dataplane.legacyAzureRead }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_BLOB_ACCOUNT_NAME" "fieldValues" .Values.app.dataplane.providers.azureBlob.accountName) }}
- name: AZURE_BLOB_AUTH_MODE
  value: {{ .Values.app.dataplane.providers.azureBlob.authMode | default "sharedKey" | quote }}
{{- if eq (.Values.app.dataplane.providers.azureBlob.authMode | default "sharedKey") "sharedKey" }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_BLOB_ACCOUNT_KEY" "fieldValues" .Values.app.dataplane.providers.azureBlob.accountKey) }}
{{- end }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_BLOB_CONTAINER" "fieldValues" .Values.app.dataplane.providers.azureBlob.container) }}
{{- if or .Values.app.dataplane.providers.azureBlob.endpoint.value .Values.app.dataplane.providers.azureBlob.endpoint.secretKeyRef.name }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_BLOB_ENDPOINT" "fieldValues" .Values.app.dataplane.providers.azureBlob.endpoint) }}
{{- end }}
{{- if or .Values.app.dataplane.providers.azureBlob.authorityHost.value .Values.app.dataplane.providers.azureBlob.authorityHost.secretKeyRef.name }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_BLOB_AUTHORITY_HOST" "fieldValues" .Values.app.dataplane.providers.azureBlob.authorityHost) }}
{{- end }}
{{- if or .Values.app.dataplane.providers.azureBlob.tokenAudience.value .Values.app.dataplane.providers.azureBlob.tokenAudience.secretKeyRef.name }}
{{- include "langwatch.secretOrValue" (dict "envName" "AZURE_BLOB_TOKEN_AUDIENCE" "fieldValues" .Values.app.dataplane.providers.azureBlob.tokenAudience) }}
{{- end }}
{{- if .Values.app.dataplane.legacyS3ReadBucket }}
# S3->Azure migration: new writes go to Azure, but objects written before the
# switch still carry s3:// URIs / bucket+key spool refs. createS3Client keeps
# serving this bucket for those reads (it fails loud only when no S3 bucket is
# configured at all), so pre-migration media, datasets, and staged payloads
# stay readable. Omit on a greenfield Azure install.
- name: S3_BUCKET_NAME
  value: {{ .Values.app.dataplane.legacyS3ReadBucket | quote }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_ENDPOINT" "fieldValues" .Values.app.dataplane.providers.awsS3.endpoint) }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_ACCESS_KEY_ID" "fieldValues" .Values.app.dataplane.providers.awsS3.accessKeyId) }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_SECRET_ACCESS_KEY" "fieldValues" .Values.app.dataplane.providers.awsS3.secretAccessKey) }}
{{- include "langwatch.secretOrValue" (dict "envName" "S3_KEY_SALT" "fieldValues" .Values.app.dataplane.providers.awsS3.keySalt) }}
{{- end }}
{{- else }}
- name: USE_S3_STORAGE
  value: "true"
# Emit S3_BUCKET_NAME — the app/server reads this name across all
# storage code paths (storage.ts, stored-objects.service.ts,
# env-create.mjs). The legacy `S3_BUCKET` env was a no-op for every
# vanilla helm install because nothing read it; emitting it was a
# silent bug that this fix resolves by aligning on S3_BUCKET_NAME.
- name: S3_BUCKET_NAME
  value: {{ .Values.app.dataplane.bucket | quote }}
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

# NextAuth secret. Lives in sharedEnv (not just the app Deployment) because
# BetterAuth initializes eagerly at import time across every consumer of the
# app image — workers and the dataset-s3-migration hook Job both pull in the
# same module graph, so any of them can crash with "You are using the default
# secret" if this is missing, regardless of whether that consumer's own logic
# ever touches auth. Same secretKeyRef precedence everywhere (explicit
# override -> existingSecret -> autogen).
{{- if .Values.app.nextAuth.secret.secretKeyRef.name }}
- name: NEXTAUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.app.nextAuth.secret.secretKeyRef.name }}
      key: {{ .Values.app.nextAuth.secret.secretKeyRef.key }}
{{- else if .Values.secrets.existingSecret }}
- name: NEXTAUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.secretKeys.nextAuthSecret | default "nextAuthSecret" }}
{{- else if .Values.autogen.enabled }}
- name: NEXTAUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "langwatch.appSecretName" . }}
      key: nextAuthSecret
{{- end }}

# Enterprise license. Optional: without one the deployment runs the open
# source edition, which caps nothing it stores on your own infrastructure.
# Setting it here entitles the whole instance, so an operator does not have
# to activate a license per organization through the UI.
#
# In sharedEnv rather than the app Deployment because plan resolution runs in
# the workers too, and a worker that reads a different entitlement than the
# app would enforce different limits on the same organization.
{{- include "langwatch.secretOrValue" (dict "envName" "LANGWATCH_LICENSE_KEY" "fieldValues" .Values.app.license.key) }}
{{- include "langwatch.secretOrValue" (dict "envName" "LANGWATCH_LICENSE_PUBLIC_KEY" "fieldValues" .Values.app.license.publicKey) }}

# Email gateway. Naming a provider is what turns email on. In sharedEnv rather
# than the app Deployment because scheduled reports and alert notifications are
# dispatched by the workers, so a workers pod without a gateway configured
# fails every send it is responsible for.
{{- include "langwatch.emailProviderGuard" . }}
{{- if .Values.app.email.provider }}
- name: EMAIL_DEFAULT_FROM
  value: {{ .Values.app.email.defaultFrom | quote }}
- name: EMAIL_PROVIDER
  value: {{ .Values.app.email.provider | quote }}
{{- if eq .Values.app.email.provider "sendgrid" }}
{{- include "langwatch.secretOrValue" (dict "envName" "SENDGRID_API_KEY" "fieldValues" .Values.app.email.providers.sendgrid.apiKey) }}
{{- end }}
{{- if eq .Values.app.email.provider "ses" }}
# USE_AWS_SES is what the mailer checks; credentials come from the pod's IAM
# role (IRSA) unless AWS_* are supplied via app.extraEnvs.
- name: USE_AWS_SES
  value: "true"
{{- /* Emitted only when set: an empty entry would shadow an AWS_REGION
       supplied through app.extraEnvs / app.extraEnvFrom. */}}
{{- if .Values.app.email.providers.ses.region }}
- name: AWS_REGION
  value: {{ .Values.app.email.providers.ses.region | quote }}
{{- end }}
{{- if .Values.app.email.providers.ses.endpoint }}
- name: AWS_SES_ENDPOINT
  value: {{ .Values.app.email.providers.ses.endpoint | quote }}
{{- end }}
{{- end }}
{{- if eq .Values.app.email.provider "smtp" }}
{{- if or .Values.app.email.providers.smtp.url.value .Values.app.email.providers.smtp.url.secretKeyRef.name }}
{{- include "langwatch.secretOrValue" (dict "envName" "SMTP_URL" "fieldValues" .Values.app.email.providers.smtp.url) }}
{{- else if .Values.app.email.providers.smtp.host }}
- name: SMTP_HOST
  value: {{ .Values.app.email.providers.smtp.host | quote }}
{{- if .Values.app.email.providers.smtp.port }}
- name: SMTP_PORT
  value: {{ .Values.app.email.providers.smtp.port | quote }}
{{- end }}
{{- /* Emptiness, not truthiness: `secure: false` is a real setting
       (force STARTTLS on 465) and must not be dropped. */}}
{{- if ne (toString .Values.app.email.providers.smtp.secure) "" }}
- name: SMTP_SECURE
  value: {{ .Values.app.email.providers.smtp.secure | toString | quote }}
{{- end }}
{{- if .Values.app.email.providers.smtp.user }}
- name: SMTP_USER
  value: {{ .Values.app.email.providers.smtp.user | quote }}
{{- include "langwatch.secretOrValue" (dict "envName" "SMTP_PASSWORD" "fieldValues" .Values.app.email.providers.smtp.password) }}
{{- end }}
{{- end }}
{{- end }}
{{- if eq .Values.app.email.provider "resend" }}
{{- include "langwatch.secretOrValue" (dict "envName" "RESEND_API_KEY" "fieldValues" .Values.app.email.providers.resend.apiKey) }}
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
{{/*
  Worker-pool size for the evaluations service, derived from the CPU the
  container is actually allowed to use.

  The service sizes its gunicorn pool from its own get_cpu_count(), whose
  "Kubernetes" branch reads /sys/fs/cgroup/cpu/cpu.shares — a cgroup **v1**
  path. Every current node runs cgroup v2, where that file does not exist, so
  the lookup raises and it falls through to sched_getaffinity(), which reports
  the NODE's CPU count. A container limited to 500m therefore forks one worker
  per node core: eight on an 8-vCPU node, sixty-four on a 64-vCPU one.

  That matters because the pool is not cheap. Each worker lazily loads its OWN
  copy of every local model it serves (PII detection, language detection), so
  resident memory grows by roughly 2.1Gi per worker as traffic round-robins
  across the pool, until every worker holds every model. Measured on a 1-CPU
  container on an 8-vCPU node: 11Gi and still climbing, having OOM-killed at
  the chart's own 8Gi default. Pinned to one worker, the same load holds flat
  at 2.5Gi.

  CPU_COUNT is the env var get_cpu_count() honours before any of that
  detection, so setting it from the limit restores the relationship an operator
  expects: ask for less CPU, get a smaller pool and a smaller footprint.

  Emitted only when the operator has not set CPU_COUNT in extraEnvs, so an
  explicit choice always wins.
*/}}
{{- define "langwatch.langevals.cpuCount" -}}
{{- $cpu := "" -}}
{{- with .Values.langevals.resources -}}
{{- $cpu = (dig "limits" "cpu" (dig "requests" "cpu" "" .) .) -}}
{{- end -}}
{{- $cpu = $cpu | toString -}}
{{- if eq $cpu "" -}}
1
{{- else if hasSuffix "m" $cpu -}}
{{- max 1 (ceil (divf (float64 (trimSuffix "m" $cpu)) 1000.0)) -}}
{{- else -}}
{{- max 1 (ceil (float64 $cpu)) -}}
{{- end -}}
{{- end -}}

{{- define "langwatch.storedObjects.localFilesystemIsActive" -}}
{{- if and .Values.app.storedObjects.localFilesystem.enabled (not .Values.app.dataplane.enabled) -}}
true
{{- end -}}
{{- end -}}

{{/*
  Default podAffinity co-locating a pod with the app pod, for consumers of the
  app's RWO stored-objects PVC (workers Deployment, dataset-s3-migration Job).
  An RWO volume attaches to ONE node, so a consumer scheduled on any other node
  sits Pending on a multi-attach error — and local-FS is the chart DEFAULT, so
  a vanilla install on a multi-node cluster would wedge without this. Required
  (not preferred) because landing off-node is never functional. Trivially
  satisfied on the documented single-node/hobby topology. Consumers render it
  only when local-FS is active AND no explicit affinity is set — an operator's
  own workers/datasetS3Migration/global affinity overrides it wholesale (they
  own scheduling then, same override semantics as the coalesce chain).
*/}}
{{- define "langwatch.storedObjects.colocationAffinity" -}}
podAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app.kubernetes.io/name: {{ .Release.Name }}-app
          app.kubernetes.io/instance: {{ .Release.Name }}
      topologyKey: kubernetes.io/hostname
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

{{/*
  Security contexts: a per-component override LAYERS onto the hardened global
  default. The operator's key wins; every key they do not mention keeps its
  default. Overriding one field is therefore never a way to drop the others.

  Use mustMergeOverwrite, not coalesce: coalesce is all-or-nothing, taking the
  component map whole as soon as it is non-empty, which makes a partial
  override behave as a full replacement. deepCopy because mustMergeOverwrite
  mutates its first argument and .Values.global is shared across every
  component in the release.

  Usage: {{- include "langwatch.podSecurityContext" (dict "ctx" . "component" .Values.app) }}
*/}}
{{- define "langwatch.podSecurityContext" -}}
{{- $global := .ctx.Values.global.podSecurityContext | default dict -}}
{{- /* Three levels, lowest priority first: global, then the component's uid
       "base", then the operator's override.

       `base` USED TO REPLACE global entirely (`.base | default $global`),
       which quietly defeated the whole point of a global default: an operator
       who raised the bar globally — seccompProfile.type: Localhost,
       supplementalGroups, fsGroupChangePolicy — got it on app/workers/nlp/
       langevals while the bundled PostgreSQL and Redis silently stayed on
       whatever `base` happened to name. The two workloads holding data were
       the two exempt from the hardening.

       Now `base` pins ONLY the keys it actually names (the uid the image
       requires, which the datastores cannot change), and every other global
       key survives underneath it.

       To DROP an inherited key rather than change it — e.g. runAsUser on
       OpenShift, where the SCC assigns one from a range — set it to null:
       `postgresql.podSecurityContext.runAsUser: null`. mustMergeOverwrite
       keeps the explicit null, which renders as no value. */ -}}
{{- $override := .component.podSecurityContext | default dict -}}
{{- toYaml (mustMergeOverwrite (deepCopy $global) (.base | default dict) $override) -}}
{{- end -}}

{{- define "langwatch.containerSecurityContext" -}}
{{- $global := .ctx.Values.global.containerSecurityContext | default dict -}}
{{- $override := .component.containerSecurityContext | default dict -}}
{{- toYaml (mustMergeOverwrite (deepCopy $global) $override) -}}
{{- end -}}

{{/*
Ingress: validated + normalised `ingress.blockedPaths`, as a JSON array.
Consume with: {{- $blocked := include "langwatch.ingress.blockedPaths" . | fromJsonArray }}

Validation is security-relevant: a trailing slash, a missing leading slash, a
bare "/" or a non-list value each leave the block rendered but inert. Rejected
here, once, by name, so both consuming templates agree.
*/}}
{{- define "langwatch.ingress.blockedPaths" -}}
  {{- $normalised := list -}}
  {{- $raw := .Values.ingress.blockedPaths -}}
  {{- if $raw -}}
    {{- if not (kindIs "slice" $raw) -}}
      {{- fail (printf "ingress.blockedPaths must be a list, got %s (%v). With --set, a list literal is assigned as a string — use --set-json 'ingress.blockedPaths=[\"/api/internal\"]', or set it in a values file." (kindOf $raw) $raw) -}}
    {{- end -}}
    {{- range $entry := $raw -}}
      {{- $path := toString $entry -}}
      {{- if not (hasPrefix "/" $path) -}}
        {{- fail (printf "ingress.blockedPaths entry %q must be an absolute path beginning with \"/\". As written it renders an Ingress the API server rejects, and blocks nothing in the meantime." $path) -}}
      {{- end -}}
      {{- /* Reject rather than normalise. `trimSuffix "/"` strips exactly ONE
             character, so "/api/internal//" became "/api/internal/" and the
             nested-path guard then compared against a prefix no real request
             path can match — rendering a blackhole rule that blocks nothing
             while an app rule for /api/internal/status out-matched it. Silently
             repairing operator input is what made that reachable; a security
             control should refuse input it cannot interpret exactly. */ -}}
      {{- if ne $path (trim $path) -}}
        {{- fail (printf "ingress.blockedPaths entry %q has leading or trailing whitespace. Kubernetes matches the path literally, so the block would never fire. Remove the whitespace." $path) -}}
      {{- end -}}
      {{- if contains "//" $path -}}
        {{- fail (printf "ingress.blockedPaths entry %q contains an empty path segment (\"//\"). No request path matches it, so the block would render but never fire. Use a single slash between segments." $path) -}}
      {{- end -}}
      {{- if eq $path "/" -}}
        {{- fail "ingress.blockedPaths may not contain \"/\" — that would route the whole site to the blackhole. Block a specific prefix, or set ingress.enabled: false." -}}
      {{- end -}}
      {{- if hasSuffix "/" $path -}}
        {{- fail (printf "ingress.blockedPaths entry %q must not end in a slash — with pathType: Prefix, %q already covers every path beneath it, and the trailing form silently fails to match the prefix itself." $path (trimSuffix "/" $path)) -}}
      {{- end -}}
      {{- $normalised = append $normalised $path -}}
    {{- end -}}
  {{- end -}}
  {{- $normalised | uniq | toJson -}}
{{- end -}}
||||||| parent of a5ec8a5b6 (feat(stored-objects): Azure Blob sign-in without a shared account key)

{{/*
ServiceAccount name for the first-party workloads (app, workers, cronjobs).
Explicit name wins; otherwise the release name when we create one; otherwise
empty, which callers treat as "omit serviceAccountName and use `default`".
*/}}
{{- define "langwatch.serviceAccountName" -}}
{{- if ((.Values.global).serviceAccount).name -}}
{{- ((.Values.global).serviceAccount).name -}}
{{- else if ((.Values.global).serviceAccount).create -}}
{{- .Release.Name -}}
{{- end -}}
{{- end }}

{{/*
Pod labels that activate cloud workload identity.

Azure's admission webhook only mutates pods carrying
`azure.workload.identity/use: "true"` — without it the projected federated
token is never injected, the pod boots healthy, and every storage write then
fails at runtime claiming the cluster is misconfigured. Rendering the label
from the same value that selects the auth mode keeps those two facts from
drifting apart.

Renders nothing unless the azureBlob provider is active in workloadIdentity
mode, so no other install gains a label.
*/}}
{{- define "langwatch.cloudIdentityPodLabels" -}}
{{- $dp := .Values.app.dataplane | default dict -}}
{{- if and $dp.enabled (eq ($dp.provider | default "") "azureBlob") -}}
{{- $azure := (($dp.providers | default dict).azureBlob | default dict) -}}
{{- if eq ($azure.authMode | default "sharedKey") "workloadIdentity" -}}
azure.workload.identity/use: "true"
{{- end -}}
{{- end -}}
{{- end }}
