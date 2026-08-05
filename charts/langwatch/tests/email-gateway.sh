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

readonly BASE="--set autogen.enabled=true --set app.email.enabled=true"

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

# shellcheck disable=SC2086
render_error() {
  local flags="$1"
  helm template lw . $flags 2>&1 | grep -m1 "Error:" || true
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
  local cases=(
    "app-extra-envs|--set app.email.provider=smtp --set app.extraEnvs[0].name=SMTP_URL --set app.extraEnvs[0].value=smtp://relay.internal:587"
    "app-extra-env-from|--set app.email.provider=ses --set app.extraEnvFrom[0].secretRef.name=aws-mailer"
    "workers-extra-envs|--set app.email.provider=smtp --set workers.extraEnvs[0].name=SMTP_HOST --set workers.extraEnvs[0].value=relay.internal"
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

# Email disabled is the default, and must stay a complete no-op.
test_disabled_email_emits_nothing() {
  local got
  got=$(email_env_of "--set autogen.enabled=true" "app/deployment.yaml")
  if [ -n "$got" ]; then
    fail "email disabled" "emitted $(echo "$got" | tr '\n' ' ')with email off"
  else
    echo "ok   [email disabled] no email configuration emitted"
  fi
}

test_workers_receive_the_same_gateway_as_the_app
test_an_unconfigured_gateway_stops_the_render
test_extra_environment_variables_are_an_accepted_source
test_an_explicit_false_reaches_the_containers
test_disabled_email_emits_nothing

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all email gateway assertions passed"
