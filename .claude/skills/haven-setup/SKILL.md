---
name: haven-setup
description: "Bring up the LangWatch dev stack via thuishaven (pnpm dev:haven) — one-time proxy/CA setup, reusing existing local ClickHouse/Postgres/Redis, WSL2/no-colima fallback for langyagent, and the known gotchas that silently break it."
user-invocable: true
argument-hint: "[--with-observability] [--managed-db] [--foreground]"
---

# Haven Setup — thuishaven local dev stack

You are bringing up the LangWatch app via haven (ADR-048), not raw `pnpm dev`. Read `dev/haven.mk` and the "Local dev by hostname" section of the root `CLAUDE.md` if you need the command reference — this skill is the field-tested runbook on top of that, including failure modes that are NOT in the docs yet.

## Step 0: Is it already running?

Before doing anything, check for an existing live stack — don't start a duplicate:

```bash
pgrep -af "cmd/haven|dev:haven"
port=$(cat ~/.portless/proxy.port 2>/dev/null); port=${port:+:$port}
curl -s -o /dev/null -w "%{http_code}\n" "https://app.<slug>.langwatch.localhost${port}/" --max-time 5
```

`~/.portless/proxy.port` holds whatever port the proxy actually bound (443 if sudo elevation worked, 1355 if it fell back — see Gotcha 3). Don't hardcode `:443` or assume no port suffix; read it.

(`<slug>` is the sanitized worktree directory name — `make haven list` shows it if unsure.) If both indicate it's up, stop here and report the URL. A background task ID from an earlier turn is NOT proof it's still alive — session/task boundaries can silently kill orphaned background processes (including the portless proxy daemon, see Gotcha 3). Always verify live state, never trust a remembered task ID.

**If that `curl` returns `000`/times out (on WSL2 especially), do NOT conclude "app not up yet" and just wait longer** — confirmed live: this burned many turns and several "is it ready yet?" round-trips where the app had been healthy the whole time and the *DNS resolution itself* was broken (Gotcha 4). Before assuming a slow cold boot, disambiguate in ~5s:

```bash
getent hosts app.<slug>.langwatch.localhost   # glibc/curl's actual resolution path
```

Empty output (while `resolvectl query` for the same name works — see Gotcha 4) means broken DNS, not a slow server — jump to Gotcha 4 immediately rather than polling `curl` in a loop. You can also confirm the app itself is fine in the meantime with `curl --resolve <host>:<port>:127.0.0.1 ...`, which bypasses glibc resolution entirely.

## Step 1: One-time setup

```bash
make haven setup
```

Installs/verifies the `portless` proxy and trusts its CA (needs port 443 + a one-time sudo prompt — see Gotcha 3 if this hangs non-interactively). Idempotent; safe to re-run.

## Step 2: Decide which services haven should manage

Read `langwatch/.env` for `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL`. If they already point at `localhost`/`127.0.0.1` and those services are actually reachable (the user said so, or you verified with e.g. `pg_isready` / `redis-cli ping` / a ClickHouse HTTP ping), reuse them instead of letting haven spin up its own containers:

```bash
LANGWATCH_HAVEN_CH=0     # reuse local ClickHouse (.env CLICKHOUSE_URL)
LANGWATCH_HAVEN_PG=0     # reuse local Postgres  (.env DATABASE_URL)
LANGWATCH_HAVEN_REDIS=0  # reuse local Redis     (.env REDIS_URL)
```

Only pass the flags for services that are actually already local — don't blanket-disable all three without checking `.env` first.

**Telemetry noise** (PostHog/GTM/Crisp/Pendo): this sandbox usually has no real internet DNS for third-party hosts, so these fail loudly in the browser console (`ERR_NAME_NOT_RESOLVED`, `[PostHog.js] Failed to fetch`) — harmless to the app itself, but noise when reading console output for a real bug. If the user wants it quiet, comment out `POSTHOG_KEY` in `.env` (gates `posthog.init()` in `src/hooks/usePostHog.ts` — commenting it out is enough, no other var needed). Don't flip `IS_SAAS` to achieve this — it's a much broader flag (billing, license enforcement, plan limits) with side effects well beyond telemetry.

**Observability** (`LANGWATCH_HAVEN_OBS=0` to skip): the LGTM stack shares ClickHouse's colima VM. If colima doesn't work on this host (see Step 3 — true on WSL2), observability won't either, so skip it whenever colima is unavailable OR the user just wants a fast/local run without it. Default to `LANGWATCH_HAVEN_OBS=0` unless the user wants the Grafana stack. **Consequence of skipping it:** the `dev:haven` npm script hardcodes `FORCE_COLOR=1`, which per `tools/thuishaven/cmd/root.go`'s `resolveAgent()` *overrides* haven's own non-tty auto-detection — so without observability, `server.log` becomes your only full-detail log source, and you MUST also pass `HAVEN_AGENT=1` (Step 4) or long structured log fields get silently truncated by the redrawing TUI.

## Step 3: Check colima — decides langyagent's isolation tier

```bash
colima start -p default
```

If this fails (common on WSL2: `lima not found` / `limactl not found in $PATH` — colima's Lima+QEMU VM approach is a poor fit for WSL2's nested-virtualization requirements, and installing lima there is a rabbit hole, not a quick fix), don't chase it. Use the documented escape hatch instead:

```bash
LANGY_UNSAFE_HOST_ACCESS=1
```

This runs the langyagent worker as a bare host process instead of inside the colima-sandboxed container (loses the per-worker UID sandbox — fine for solo local dev, not for anything multi-tenant). Tell the user this tradeoff in one line; don't silently downgrade isolation without saying so.

**If you use `LANGY_UNSAFE_HOST_ACCESS=1`, you also need the `opencode` binary on `$PATH`** — normally baked into the colima container image, absent on the bare host. Symptom if missing: `POST /worker/create` in the logs shows `error=start opencode`, `.cause=exec: "opencode"`. Fix (pin version + hash to whatever `Dockerfile.langyagent` currently specifies — don't hardcode a version here, it drifts):

```bash
v=$(grep -oP 'ARG OPENCODE_VERSION=\K.*' Dockerfile.langyagent)
sha=$(grep -oP 'OPENCODE_SHA256_AMD64=\K[0-9a-f]+' Dockerfile.langyagent)  # or ARM64 on arm hosts
cd /tmp
curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${v}/opencode-linux-x64.tar.gz" -o opencode.tar.gz
echo "${sha}  opencode.tar.gz" | sha256sum -c -
tar -xzf opencode.tar.gz
install -m0755 opencode ~/.local/bin/opencode   # confirm this dir is on $PATH first
rm -f opencode opencode.tar.gz
```

**Even with `opencode` installed and every DNS issue fixed, the chat can still hang until `AGENT_CHAT_TIMEOUT_MS` (120s) with no visible error** — symptom: worker creates fine (202 on `/worker/create`), SSE connects fine, but the panel sits on "Starting up…" / "Reconnecting to the agent…" forever. Root cause: the per-worker egress adapter (`services/langyagent/adapters/egress/enforcing.go`, ADR-043) enforces `EgressRequireTLS` by default — "only opaque CONNECT :443 tunnels; cleartext forwards... are refused" — and the worker's own `OPENAI_BASE_URL` points at the manager's LOCAL loopback relay over plain `http://` (not `:443`/TLS), so its own legitimate LLM call gets refused by this rung. `NO_PROXY` is supposed to route this call around the egress proxy entirely (`127.0.0.1` is in the list), but something in opencode's Bun runtime still routes it through — not fully root-caused, just confirmed as the trigger. Confirm this is the failure (not DNS, not a missing binary) by tailing opencode's own **unbuffered** per-session log — do NOT rely on `server.log` here, see Gotcha 5:

```bash
find ~/.langwatch/portless/langyagent -iname opencode.log 2>/dev/null | xargs tail -f
# look for: level=ERROR message="stream error" ... error.error="AI_APICallError: failed to execute HTTP request to provider API"
```

Fix — disable require-TLS for local dev (config-only, no rebuild; safe because `LANGY_UNSAFE_HOST_ACCESS=1` already accepts reduced isolation, so this defense-in-depth layer for the *sandboxed* tier has no teeth to lose here):

```bash
LANGY_EGRESS_REQUIRE_TLS=false
```

Add it to the Step 5 command alongside `LANGY_UNSAFE_HOST_ACCESS=1`. Verify by sending a real message and confirming a real model reply appears within a few seconds — a `curl` test straight at the worker's `OPENAI_BASE_URL` (grab it from `cat /proc/<opencode-pid>/environ | tr '\0' '\n' | grep OPENAI_BASE_URL`, then `POST .../chat/completions` with a `gpt-5-mini` body) is a fast way to confirm the gateway/provider chain itself works before touching this flag, so you don't chase the wrong layer.

## Step 4: Check `.env` for stale k8s/Minikube overrides

`resolveWorkerCallbackUrl()` / `resolveWorkerGatewayBaseUrl()` (`langwatch/src/server/app-layer/langy/LangyCredentialService.ts`) check `LANGY_WORKER_CALLBACK_URL` / `LANGY_WORKER_GATEWAY_URL` **before** haven's own correctly-resolved URLs. If the user has previously run the stack via the `k8s` skill (Minikube), `.env` may have these hardcoded to `host.minikube.internal:<port>` — which doesn't resolve outside a Minikube VM and silently breaks **every** LLM call and turn-output callback under haven (symptom: chat sends, worker creates fine, but no reply ever arrives — no visible error to the user, just retries forever). Check:

```bash
grep -n "LANGY_WORKER_CALLBACK_URL\|LANGY_WORKER_GATEWAY_URL" langwatch/.env
```

If either is set to a `minikube`/`docker.internal`-style host and you're running under haven (not actually inside that k8s pod), comment both out (don't delete — the user may switch back to the k8s workflow later) with a one-line note why. Confirm the fix by checking for `lookup host.minikube.internal ... no such host` in the logs after a restart — that error should disappear.

## Step 5: Bring it up

```bash
cd langwatch
LANGWATCH_HAVEN_CH=0 LANGWATCH_HAVEN_PG=0 LANGWATCH_HAVEN_REDIS=0 \
LANGWATCH_HAVEN_OBS=0 LANGY_UNSAFE_HOST_ACCESS=1 HAVEN_AGENT=1 \
LANGY_EGRESS_REQUIRE_TLS=false \
pnpm dev:haven
```

(Adjust the CH/PG/REDIS/OBS/HOST_ACCESS flags per Steps 2-3's findings; always keep `HAVEN_AGENT=1` when observability is off; `LANGY_EGRESS_REQUIRE_TLS=false` is only needed alongside `LANGY_UNSAFE_HOST_ACCESS=1` — see the note under Step 3 — omit it if running the sandboxed/colima tier.) Run via the Bash tool with `run_in_background: true` — this is a long-running dev server, never foreground. Wait for readiness with a Monitor/until-loop polling the app URL for `200`, not a blind `sleep`.

**If that readiness loop runs past ~2 minutes**, don't keep telling the user "still booting" — `ps` for the actual server process (e.g. `pgrep -af server.mts`) first. If the process is alive and burning CPU, the app itself is not the bottleneck; re-run the Step 0 `getent hosts` check immediately rather than waiting longer, since a broken resolver (Gotcha 4) makes every readiness `curl` fail identically to a slow boot and the two are easy to conflate under repeated "is it up yet" pressure.

Verify with the same port-aware curl from Step 0. If DNS resolution itself fails (not just connection refused) — for `*.langwatch.localhost` generally, not only your slug — see Gotcha 4 before assuming the stack is broken.

To sign in for a browser check (Playwright or otherwise), use the fixed local-dev seed identity — documented in `langwatch/prisma/seed.ts`'s own header comment, not a secret:

```
Email:    admin@haven.localhost
Password: LocalHavenAdmin!2026
```

**Sign-in only works against the app's actual configured `NEXTAUTH_URL` origin** (`.env.portless` sets this to the real `https://app.<slug>.langwatch.localhost:<port>` hostname) — hitting the app via its raw `127.0.0.1:<port>` bypasses DNS/CA issues for a bare health check (`curl` 200 on `/`), but `/api/auth/sign-in/email` will 403 from there since the Origin doesn't match. Don't waste time debugging that 403 as an app bug — it's the trusted-origin check working as intended. Real login (and thus any authenticated flow, including Langy chat) needs the hostname to actually resolve — see Gotcha 4.

## Gotcha 3: portless proxy daemon dies independently of your dev-server process

The `portless` proxy is a separate persistent daemon bound to privileged port 443 (started with a one-time sudo elevation). It normally outlives individual `haven up` restarts — but a harness session/task-boundary teardown can kill it too, not just your foreground `pnpm dev:haven`. When it restarts without an interactive TTY for the sudo password, it falls back to port 1355 — and if an **earlier privileged run left root-owned state files** (`~/.portless/proxy.tls`, `~/.portless/ca.srl`), the unprivileged fallback ALSO fails with `EACCES: permission denied, open '.../proxy.tls'`, and the whole stack refuses to start (`haven: could not start the portless proxy automatically`).

Diagnose:

```bash
tail -n 40 ~/.portless/proxy.log
ls -la ~/.portless/    # look for files NOT owned by your user
```

**You do NOT need sudo for this** — deleting a file only requires write permission on its *containing directory*, not the file itself, and `~/.portless` is owned by you (only the two marker files inside it are stray root-owned leftovers). Just delete them yourself and let portless regenerate them fresh:

```bash
rm -f ~/.portless/proxy.tls ~/.portless/ca.srl
make haven setup   # or retry pnpm dev:haven directly
```

It'll still fall back to the unprivileged port (1355) since there's no interactive TTY for the sudo *elevation* itself (that part genuinely can't be done non-interactively without the user's password) — that's fine, just means the app URL is `https://app.<slug>.langwatch.localhost:1355` instead of the clean port-443 form. Note the `:1355` in every URL you report back. Only ask the user to run something themselves if `make haven setup` still fails after clearing these files.

## Gotcha 4: `*.langwatch.localhost` stops resolving (WSL2 resolv.conf drift)

Symptom: `curl`/`getent`/the browser all report "could not resolve host" for `app.<slug>.langwatch.localhost` — even a generic `foo.localhost` fails the same way — while the app itself boots fine and `resolvectl query app.<slug>.langwatch.localhost` correctly returns `127.0.0.1` (`-- Data from: synthetic`). This is a WSL2-specific DNS drift, not a haven/portless bug: `systemd-resolved`'s local stub (`127.0.0.53`) is what actually synthesizes `.localhost` addresses per RFC 6761, but WSL2 periodically regenerates `/etc/resolv.conf` (it's a symlink to `/mnt/wsl/resolv.conf`) to point straight at its upstream gateway resolver instead (e.g. `nameserver 10.255.255.254`), bypassing the stub entirely for plain glibc resolution (`curl`, `getent`, Node, browsers) even though `resolvectl` itself still works (it talks to resolved directly, not through glibc NSS).

Diagnose:

```bash
cat /etc/resolv.conf                              # look for anything other than 127.0.0.53
resolvectl query app.<slug>.langwatch.localhost   # should say "Data from: synthetic" if resolved can do it
systemctl is-active systemd-resolved              # should be "active"
```

`/etc` is root-owned with no directory-permission workaround available (unlike Gotcha 3) — this one genuinely needs the user. **Use TWO nameservers, not one** — `systemd-resolved` on this host has no upstream DNS server configured for any link (`resolvectl status` shows "Current Scopes: none" everywhere), so it can only answer its own synthetic `.localhost` records. Pointing `resolv.conf` at `127.0.0.53` alone fixes `.langwatch.localhost` but silently breaks ALL real internet DNS (`curl https://api.openai.com` → `Could not resolve host`) — which then manifests as LLM calls hanging until `AGENT_CHAT_TIMEOUT_MS` (120s) instead of an obvious error, since the request never even leaves the box. Give the user this exact one-liner (via `!` or their own terminal) — glibc's resolver falls through to the second nameserver when the first returns SERVFAIL for a non-synthetic domain, so this fixes both at once:

```bash
sudo bash -c 'printf "nameserver 127.0.0.53\nnameserver 10.255.255.254\n" > /etc/resolv.conf'
```

Verify BOTH after the fix, not just the app hostname — a fix that only restores `.localhost` and silently leaves real DNS broken is worse than not fixing it, since the failure mode (a 120s hang, not a clear error) is much harder to diagnose next time:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.openai.com/v1/models --max-time 8   # expect 401 (reached, unauthorized) not a resolve failure
curl -s -o /dev/null -w "%{http_code}\n" "https://app.<slug>.langwatch.localhost<port>/" --max-time 8
```

This can drift back after a full WSL restart (`wsl --shutdown` from Windows) since WSL regenerates the file by default — if it recurs across sessions, mention the durable fix (`generateResolvConf = false` under `[network]` in `/etc/wsl.conf`, then a WSL restart to apply) as optional follow-up, not something to push on unprompted.

## Gotcha 5: `server.log` can silently stop reflecting reality under `HAVEN_AGENT=1`

Even with `HAVEN_AGENT=1` (Step 2's fix for TUI truncation), `server.log`/the raw background-task output can stop growing entirely for minutes at a time while the stack is demonstrably alive and actively serving requests (confirmed via a working browser session in parallel). This looks like stdout buffering somewhere in the haven → tee pipeline in this mode specifically — don't trust "the log hasn't grown" as proof nothing is happening. Cross-check with:

```bash
ps -eo pid,ppid,etime,pcpu,cmd | grep -E "langyagent|aigateway|nlpgo|opencode"   # alive + burning CPU = still working, not hung
```

When the log looks frozen, prefer **browser-side signal** over waiting on stdout: drive the actual flow (Playwright `browser_run_code_unsafe`, see below) and capture `page.on('console', ...)` — the tRPC/SSE debug logging in the Langy panel (`>> subscription #N langy.onTurnStream`, `SSE connected`, eventual `SSE Error` with `elapsedMs`) gives a real, live timeline even when the server's own stdout is stuck. This surfaced the actual root cause once (Gotcha 4's DNS regression) when server.log alone would have looked like nothing was happening at all.

**Driving Langy through a browser when Playwright's managed Chromium doesn't trust the portless CA:** don't install `certutil`/`libnss3-tools` for this — there's a zero-install workaround. `browser_run_code_unsafe`'s sandboxed function does NOT retain state between separate tool calls (`globalThis` resets each call), so do the entire flow — login, open panel, send message, poll for reply — in **one** script per call:

```js
async (page) => {
  const browser = page.context().browser();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });  // sidesteps CA trust, no OS changes
  const p = await ctx.newPage();
  await p.goto('https://app.<slug>.langwatch.localhost<port>/auth/signin', { waitUntil: 'domcontentloaded' });
  // ... login with the seed identity above, click "Open Langy assistant", fill the composer, click Send, poll innerText ...
}
```

Do NOT try to verify the authenticated flow via the raw `http://127.0.0.1:<app-port>/` origin instead of the real hostname — `NEXTAUTH_URL` (set by `.env.portless` to the real hostname) makes the auth layer 403 any sign-in request whose Origin doesn't match exactly. The direct-IP origin is fine for an anonymous health check (`curl` 200 on `/`) but will never get you past login.

## Reporting back

Once verified, tell the user: the exact command/flags you started it with (so they can restart it identically), the app URL, and any gotcha you had to work around (stale env, missing colima, missing opencode, portless ownership) — these are easy to hit again on the next restart and worth remembering, not just silently fixing.
