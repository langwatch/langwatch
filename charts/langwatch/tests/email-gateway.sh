#!/usr/bin/env bash
#
# Renders the chart and asserts what the containers actually receive for email:
# which Deployments get the gateway configuration, and which misconfigurations
# stop the render instead of the first send.
#
# This executes the template pipeline rather than reading it. The env block sits
# behind nested provider conditionals and a `fail` guard, so a branch that stops
# emitting a variable, a truthiness guard that eats a boolean `false`, or a
# helper that quietly renders into only one Deployment is visible only by
# rendering both and comparing them.
#
# Why the Deployment split matters: scheduled reports and alert notifications
# are dispatched by the workers, not the web application. Configuration that
# reaches only the app Deployment leaves those sends with no gateway at all,
# and nothing about the app's own successful sends reveals that.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies. The next
# line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/email-gateway.sh

set -euo pipefail

cd "$(dirname "$0")/.."

readonly BASE="--set autogen.enabled=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Every email-related env name in one Deployment, sorted, one per line. Scoped
# to a single Deployment so a variable present only in the app can never
# satisfy an assertion about the workers.
#
# A failed render yields no names rather than killing the run under `set -e`,
# so a chart that stops rendering is reported as the assertion it broke instead
# of as a bare helm error with no indication of which case produced it.
email_env_of() {
  local flags="$1" source="$2"
  # shellcheck disable=SC2086
  { helm template lw . $flags 2>/dev/null || true; } | awk -v want="$source" '
    $0 ~ "^# Source: langwatch/templates/" want { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab && /- name: (EMAIL_|SMTP_|RESEND_API_KEY|SENDGRID_API_KEY|USE_AWS_SES|AWS_SES_ENDPOINT|AWS_REGION)/ {
      gsub(/^[ -]*name: /, ""); print
    }
  ' | sort -u
}

# The value of one env var in one Deployment. Same failed-render handling as
# email_env_of.
env_value_of() {
  local flags="$1" source="$2" name="$3"
  # shellcheck disable=SC2086
  { helm template lw . $flags 2>/dev/null || true; } | awk -v want="$source" -v key="$name" '
    $0 ~ "^# Source: langwatch/templates/" want { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab && $0 ~ ("- name: " key "$") { hit=1; next }
    grab && hit && /value:/ { gsub(/"/,"",$2); print $2; hit=0 }
  ' | head -n 1
}

# Renders and reports whether it succeeded, without aborting this script.
render_status() {
  local flags="$1"
  # shellcheck disable=SC2086
  if helm template lw . $flags >/dev/null 2>&1; then echo "ok"; else echo "failed"; fi
}

# The whole failure on one line. helm splits its errors across lines, putting
# the template location on the "Error:" line and the reason underneath, so
# taking only the first line would drop what the assertion is about.
# shellcheck disable=SC2086
render_error() {
  local flags="$1"
  # The trailing `|| true` is what keeps a refused render, which is the only
  # kind this is called for, from ending the run under `set -e -o pipefail`.
  helm template lw . $flags 2>&1 | sed -n '/^Error:/,$p' | grep -v '^Use --debug' | tr '\n' ' ' || true
}

# @scenario "Background jobs can send email as well as the web application"
test_workers_receive_the_same_gateway_as_the_app() {
  local entry label flags app workers
  local cases=(
    "sendgrid|--set app.email.provider=sendgrid --set app.email.providers.sendgrid.apiKey.value=SG.example"
    "ses|--set app.email.provider=ses --set app.email.providers.ses.region=eu-central-1 --set app.email.providers.ses.endpoint=https://vpce.example.internal"
    "smtp-url|--set app.email.provider=smtp --set app.email.providers.smtp.url.value=smtp://relay.internal:587"
    "smtp-host|--set app.email.provider=smtp --set app.email.providers.smtp.host=relay.internal --set app.email.providers.smtp.port=2525 --set app.email.providers.smtp.user=mailer --set app.email.providers.smtp.password.value=hunter2"
    "resend|--set app.email.provider=resend --set app.email.providers.resend.apiKey.value=re_example"
    "secret-refs|--set app.email.provider=resend --set app.email.providers.resend.apiKey.secretKeyRef.name=mail --set app.email.providers.resend.apiKey.secretKeyRef.key=resendApiKey"
  )
  for entry in "${cases[@]}"; do
    label="${entry%%|*}"
    flags="${entry#*|}"
    app=$(email_env_of "$BASE $flags" "app/deployment.yaml")
    workers=$(email_env_of "$BASE $flags" "workers/deployment.yaml")
    if [ -z "$app" ]; then
      fail "$label" "the app Deployment received no email configuration at all"
      continue
    fi
    if [ "$app" != "$workers" ]; then
      fail "$label" "workers received $(echo "$workers" | tr '\n' ' ')but the app received $(echo "$app" | tr '\n' ' ')"
      continue
    fi
    echo "ok   [$label] both Deployments received: $(echo "$app" | tr '\n' ' ')"
  done
}

# @scenario "A gateway named but never configured is caught before install"
test_an_unconfigured_gateway_stops_the_render() {
  local entry label flags err
  local cases=(
    "sendgrid-without-a-key|--set app.email.provider=sendgrid"
    "ses-without-a-region|--set app.email.provider=ses"
    "smtp-without-a-host-or-url|--set app.email.provider=smtp"
    "resend-without-a-key|--set app.email.provider=resend"
    "a-gateway-that-does-not-exist|--set app.email.provider=mailgun --set app.email.providers.resend.apiKey.value=re_example"
  )
  for entry in "${cases[@]}"; do
    label="${entry%%|*}"
    flags="${entry#*|}"
    if [ "$(render_status "$BASE $flags")" = "ok" ]; then
      fail "$label" "rendered successfully; the mistake would surface at the first send instead"
      continue
    fi
    err=$(render_error "$BASE $flags")
    case "$err" in
      *"app.email"*) echo "ok   [$label] render refused" ;;
      *) fail "$label" "render failed without naming the email setting: ${err:-<no Error: line>}" ;;
    esac
  done
}

# @scenario "Settings supplied out of band are accepted"
test_extra_environment_variables_are_an_accepted_source() {
  local entry label flags
  local both="--set app.extraEnvs[0].name=SMTP_URL --set app.extraEnvs[0].value=smtp://relay.internal:587 --set workers.extraEnvs[0].name=SMTP_URL --set workers.extraEnvs[0].value=smtp://relay.internal:587"
  local cases=(
    "extra-envs-on-both|--set app.email.provider=smtp $both"
    "extra-env-from-on-both|--set app.email.provider=ses --set app.extraEnvFrom[0].secretRef.name=aws-mailer --set workers.extraEnvFrom[0].secretRef.name=aws-mailer"
    "app-only-with-workers-off|--set app.email.provider=smtp --set workers.enabled=false --set app.extraEnvs[0].name=SMTP_URL --set app.extraEnvs[0].value=smtp://relay.internal:587"
  )
  for entry in "${cases[@]}"; do
    label="${entry%%|*}"
    flags="${entry#*|}"
    if [ "$(render_status "$BASE $flags")" = "ok" ]; then
      echo "ok   [$label] render allowed"
    else
      fail "$label" "render refused even though the settings can arrive out of band: $(render_error "$BASE $flags")"
    fi
  done
}

# Supplying the settings to one Deployment says nothing about the other, since
# each reads only its own extra environment. Accepting one side would leave the
# other believing email is configured and unable to send.
#
# @scenario "Settings supplied to only one of the two Deployments are refused"
test_out_of_band_settings_must_reach_every_sender() {
  local entry label flags want err
  local cases=(
    "app-only|workers.extraEnvs|--set app.email.provider=smtp --set app.extraEnvs[0].name=SMTP_URL --set app.extraEnvs[0].value=smtp://relay.internal:587"
    "workers-only|app.extraEnvs|--set app.email.provider=smtp --set workers.extraEnvs[0].name=SMTP_HOST --set workers.extraEnvs[0].value=relay.internal"
  )
  for entry in "${cases[@]}"; do
    label="${entry%%|*}"
    want="${entry#*|}"; want="${want%%|*}"
    flags="${entry##*|}"
    if [ "$(render_status "$BASE $flags")" = "ok" ]; then
      fail "$label" "rendered successfully, so the other Deployment would install with no gateway"
      continue
    fi
    err=$(render_error "$BASE $flags")
    case "$err" in
      *"$want"*) echo "ok   [$label] render refused, pointing at $want" ;;
      *) fail "$label" "render failed without naming $want: ${err:-<no Error: line>}" ;;
    esac
  done
}

# A secretKeyRef naming a Secret but no key inside it reads as configured to the
# provider guard and resolves to nothing in the container.
#
# @scenario "A secret reference missing its key is caught before install"
test_a_half_written_secret_reference_stops_the_render() {
  local entry label flags err
  local cases=(
    "sendgrid-api-key|--set app.email.provider=sendgrid --set app.email.providers.sendgrid.apiKey.secretKeyRef.name=mail"
    "resend-api-key|--set app.email.provider=resend --set app.email.providers.resend.apiKey.secretKeyRef.name=mail"
    "smtp-url|--set app.email.provider=smtp --set app.email.providers.smtp.url.secretKeyRef.name=mail"
    "smtp-password|--set app.email.provider=smtp --set app.email.providers.smtp.host=relay.internal --set app.email.providers.smtp.password.secretKeyRef.name=mail"
  )
  for entry in "${cases[@]}"; do
    label="${entry%%|*}"
    flags="${entry#*|}"
    if [ "$(render_status "$BASE $flags")" = "ok" ]; then
      fail "$label" "rendered successfully; the container would receive a Secret reference with no key"
      continue
    fi
    err=$(render_error "$BASE $flags")
    case "$err" in
      *"is set but key is empty"*) echo "ok   [$label] render refused" ;;
      *) fail "$label" "render failed without naming the empty key: ${err:-<no Error: line>}" ;;
    esac
  done

  # A complete reference is the normal case and must still render.
  flags="--set app.email.provider=smtp --set app.email.providers.smtp.url.secretKeyRef.name=mail --set app.email.providers.smtp.url.secretKeyRef.key=smtpUrl"
  if [ "$(render_status "$BASE $flags")" = "ok" ]; then
    echo "ok   [complete-secret-ref] render allowed"
  else
    fail "complete-secret-ref" "render refused for a complete secret reference: $(render_error "$BASE $flags")"
  fi
}

# @scenario "Forcing an unencrypted starting connection is not silently dropped"
test_an_explicit_false_reaches_the_containers() {
  local flags source got
  flags="--set app.email.provider=smtp --set app.email.providers.smtp.host=relay.internal --set app.email.providers.smtp.port=465 --set app.email.providers.smtp.secure=false"
  for source in app/deployment.yaml workers/deployment.yaml; do
    got=$(env_value_of "$BASE $flags" "$source" SMTP_SECURE)
    if [ "$got" != "false" ]; then
      fail "secure=false in ${source%%/*}" "SMTP_SECURE is '${got:-<absent>}', expected 'false'"
      continue
    fi
    echo "ok   [secure=false in ${source%%/*}] SMTP_SECURE=$got"
  done

  # And the setting stays optional: left unset, nothing is emitted and the
  # application applies its port-based default.
  flags="--set app.email.provider=smtp --set app.email.providers.smtp.host=relay.internal"
  got=$(env_value_of "$BASE $flags" "app/deployment.yaml" SMTP_SECURE)
  if [ -n "$got" ]; then
    fail "secure unset" "SMTP_SECURE rendered as '$got', expected nothing"
  else
    echo "ok   [secure unset] no SMTP_SECURE emitted"
  fi
}

# No provider named is the default, and must stay a complete no-op.
test_no_provider_emits_nothing() {
  local got
  got=$(email_env_of "$BASE" "app/deployment.yaml")
  if [ -n "$got" ]; then
    fail "no provider" "emitted $(echo "$got" | tr '\n' ' ')with no provider named"
  else
    echo "ok   [no provider] no email configuration emitted"
  fi
}

# @scenario "The retired enable toggle is refused rather than ignored"
test_the_retired_enabled_toggle_is_refused() {
  local err
  if [ "$(render_status "$BASE --set app.email.enabled=true --set app.email.provider=sendgrid --set app.email.providers.sendgrid.apiKey.value=SG.example")" = "ok" ]; then
    fail "stale app.email.enabled" "rendered successfully, so a values file carrying the old toggle would look correct"
    return
  fi
  err=$(render_error "$BASE --set app.email.enabled=true --set app.email.provider=sendgrid --set app.email.providers.sendgrid.apiKey.value=SG.example")
  case "$err" in
    *"app.email.enabled no longer exists"*) echo "ok   [stale app.email.enabled] render refused with the migration message" ;;
    *) fail "stale app.email.enabled" "render failed without explaining the change: ${err:-<no Error: line>}" ;;
  esac
}

test_workers_receive_the_same_gateway_as_the_app
test_an_unconfigured_gateway_stops_the_render
test_extra_environment_variables_are_an_accepted_source
test_out_of_band_settings_must_reach_every_sender
test_a_half_written_secret_reference_stops_the_render
test_an_explicit_false_reaches_the_containers
test_no_provider_emits_nothing
test_the_retired_enabled_toggle_is_refused

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all email gateway assertions passed"
