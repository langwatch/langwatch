---
name: haven-setup
description: "Bring the LangWatch dev stack up through thuishaven (make haven up) and get past the failures that look like a slow boot: the portless proxy's port and root-owned state, .localhost DNS drift on WSL2, the langy worker's missing opencode binary and TLS-refused egress, stale k8s callback URLs in .env, and a frozen log. The command reference and the no-container flags are in the root CLAUDE.md; this is only what CLAUDE.md does not say."
user-invocable: true
argument-hint: "[--with-observability] [--managed-db] [--foreground]"
---

# haven, the parts that bite

Read the "Local dev by hostname" section of the root `CLAUDE.md` first: it has
`make haven up`, `make haven status`, `haven logs`, the `LANGWATCH_HAVEN_CH=0` /
`LANGWATCH_HAVEN_OBS=0` / `LANGY_UNSAFE_HOST_ACCESS=1` no-container path, and the
`--agent` flag. `dev/haven.mk` and `tools/thuishaven/README.md` are the reference.
Everything below is a failure mode that is not documented there.

Run every command from the **workspace root**, where `.env` lives. haven's own
resolved values are never written to a file: it injects them into every process
it starts, and `eval "$(haven env)"` loads the same set into your shell.

## Before starting: is a stack already up?

```bash
pgrep -af "cmd/haven"
port=$(cat ~/.portless/proxy.port 2>/dev/null); port=${port:+:$port}
curl -s -o /dev/null -w "%{http_code}\n" "https://app.<slug>.langwatch.localhost${port}/" --max-time 5
```

`~/.portless/proxy.port` holds whatever port the proxy actually bound — 443 when sudo
elevation worked, 1355 when it fell back. Read it; never hardcode. `<slug>` is the
sanitised worktree directory name; `make haven status` prints it. A background task id
from an earlier turn is not proof anything is alive.

A `000`/timeout is **not** proof the app is still booting. Disambiguate first:

```bash
getent hosts app.<slug>.langwatch.localhost
```

Empty output means broken resolution, not a slow server. `curl --resolve
<host>:<port>:127.0.0.1 …` bypasses glibc entirely and confirms the app itself.

## Gotcha 1: the portless proxy dies independently of the stack

The proxy is a separate daemon on privileged 443, started with a one-time sudo
elevation, and a harness session teardown can kill it. Restarting without a TTY drops it
to 1355 — and if an earlier privileged run left root-owned state, even that fails with
`EACCES` on `~/.portless/proxy.tls` and the stack refuses to start.

```bash
tail -n 40 ~/.portless/proxy.log
ls -la ~/.portless/            # look for files not owned by you
rm -f ~/.portless/proxy.tls ~/.portless/ca.srl   # no sudo needed: the directory is yours
make haven up                  # re-installs and re-trusts the CA itself
```

It will still bind 1355 without an interactive sudo prompt. Quote the `:1355` in every
URL you report.

## Gotcha 2: `*.langwatch.localhost` stops resolving (WSL2)

`curl`, `getent` and the browser all fail to resolve — even a bare `foo.localhost` —
while `resolvectl query …` returns `127.0.0.1` from `synthetic`. WSL2 regenerates
`/etc/resolv.conf` to point straight at the upstream gateway, bypassing
`systemd-resolved`'s stub, which is what synthesises `.localhost`.

```bash
cat /etc/resolv.conf                              # anything other than 127.0.0.53
resolvectl query app.<slug>.langwatch.localhost   # "Data from: synthetic" if resolved can
systemctl is-active systemd-resolved
```

`/etc` needs the user. Give them **two** nameservers, not one — with only `127.0.0.53`,
real internet DNS breaks and LLM calls hang for the full chat timeout instead of erroring:

```bash
sudo bash -c 'printf "nameserver 127.0.0.53\nnameserver 10.255.255.254\n" > /etc/resolv.conf'
```

Verify both afterwards: a real host (expect a 401, not a resolve failure) and the app
hostname. It drifts back after `wsl --shutdown`; the durable fix is
`generateResolvConf = false` under `[network]` in `/etc/wsl.conf`.

## Gotcha 3: langy on the host needs `opencode`, and its egress refuses cleartext

With `LANGY_UNSAFE_HOST_ACCESS=1` the langy worker runs as a bare host process, so the
`opencode` binary baked into the container image is absent. Symptom:
`POST /worker/create` logs `error=start opencode`, `.cause=exec: "opencode"`. Install the
version and hash `infra/docker/Dockerfile.langyagent` currently pins — read them from the
file, do not hardcode.

Even with it installed the chat can hang until the chat timeout with no visible error:
worker creates (202), SSE connects, the panel sits on "Starting up…". The per-worker
egress adapter (`services/langyagent/adapters/egress/enforcing.go`) requires TLS, and the
worker's own `OPENAI_BASE_URL` points at the manager's loopback relay over plain HTTP.
Confirm from opencode's own unbuffered log before touching anything:

```bash
find ~/.langwatch/portless/langyagent -iname opencode.log 2>/dev/null | xargs tail -f
# look for: AI_APICallError: failed to execute HTTP request to provider API
```

Fix, config only, and only alongside `LANGY_UNSAFE_HOST_ACCESS=1` (that tier has already
accepted reduced isolation): `LANGY_EGRESS_REQUIRE_TLS=false`.

## Gotcha 4: stale k8s overrides in `.env`

`resolveWorkerCallbackUrl` / `resolveWorkerGatewayBaseUrl`
(`modules/langy/contract/src/credential.ts`) read `LANGY_WORKER_CALLBACK_URL`
and `LANGY_WORKER_GATEWAY_URL` **before** haven's own resolved URLs. Left over from a
Minikube run they point at `host.minikube.internal`, which resolves nowhere under haven
and silently breaks every LLM call and turn callback — no error, just retries.

```bash
grep -n "LANGY_WORKER_CALLBACK_URL\|LANGY_WORKER_GATEWAY_URL" .env
```

Comment both out with a one-line note; do not delete them.

## Gotcha 5: the log can freeze while the stack is healthy

Output can stop growing for minutes under `HAVEN_AGENT=1` while requests are being
served. Do not read "the log has not grown" as "nothing is happening".

```bash
ps -eo pid,ppid,etime,pcpu,cmd | grep -E "langyagent|aigateway|nlpgo|opencode"
```

With the observability stack up, query Grafana instead — `gcx logs query
'{service_name="langwatch-app"} | langwatch_worktree="<slug>"' --since 15m`. See
`dev/docs/best_practices/local-observability.md`. Otherwise drive the flow in a browser
and read `page.on('console', …)`: the tRPC/SSE logging gives a live timeline the server's
stdout does not.

## Signing in for a browser check

The local-dev seed identity is documented in
`packages/prisma-client/prisma/seed.ts`'s own header — not a secret. Sign-in only works
against the origin the app is configured with (haven sets `NEXTAUTH_URL` to the
real `https://app.<slug>.langwatch.localhost:<port>`; auth is better-auth, but that
variable is still what names the trusted origin, bound in
`apps/api/src/platform/config/api.config.ts`). Hitting the app on raw `127.0.0.1:<port>`
is fine for an anonymous health check and will always 403 the sign-in — that is the
trusted-origin check working, not a bug.

Playwright's managed Chromium does not trust the portless CA; open a context with
`ignoreHTTPSErrors: true` rather than installing `certutil`. `browser_run_code_unsafe`
resets `globalThis` between calls, so do login, navigation and assertion in one script.

## Reporting back

The exact command and flags you started it with, the app URL including its port, and
every gotcha you worked around — they recur on the next restart.
