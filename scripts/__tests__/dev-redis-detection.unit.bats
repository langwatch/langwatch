#!/usr/bin/env bats
# Unit tests for the host-Redis detection logic in scripts/dev.sh —
# redis_listener_is_usable() and the frontend-only reuse/start/error branch
# in run_frontend_only().
#
# Why this exists: redis_port_in_use() only proves *something* owns host port
# 6379. Reusing that as Redis (REDIS_URL=redis://localhost:6379, skipping
# `$COMPOSE up -d redis`) silently breaks the in-process BullMQ workers when
# the listener is a non-Redis process or a Redis that needs auth/TLS. The fix
# verifies the listener with `redis-cli ... ping` (PONG) before reuse, errors
# out when 6379 is occupied by something unverifiable, and only starts its own
# container when the port is free. (CodeRabbit review 4579126710, #5143.)
#
# dev.sh runs no app/compose when sourced: the `BASH_SOURCE != $0` guard near
# the bottom returns after the function definitions. We source it inside a
# `bash -c` whose argv0 is a single token so dev.sh's
# `. "$(dirname "$0")/lib/write-dev-overrides.sh"` resolves relative to the
# scripts/ working directory.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"

  # Workdir whose langwatch/ subdir lets run_frontend_only's trailing
  # `(cd langwatch && ... pnpm dev)` succeed without a real checkout.
  WORKDIR="$TEST_DIR/work"
  mkdir -p "$WORKDIR/langwatch"

  # redis-cli stub that answers PING with PONG (a real, usable local Redis).
  STUB_PONG="$TEST_DIR/bin-pong"
  mkdir -p "$STUB_PONG"
  printf '%s\n' '#!/usr/bin/env bash' 'echo PONG' > "$STUB_PONG/redis-cli"

  # redis-cli stub that answers with a non-PONG reply (a listener that is not
  # a usable Redis — e.g. another service, or a Redis demanding auth).
  STUB_BAD="$TEST_DIR/bin-bad"
  mkdir -p "$STUB_BAD"
  printf '%s\n' '#!/usr/bin/env bash' 'echo WRONGREPLY' > "$STUB_BAD/redis-cli"

  # Empty dir used as the entire PATH to simulate redis-cli being absent.
  EMPTY_DIR="$TEST_DIR/empty"
  mkdir -p "$EMPTY_DIR"

  # pnpm stub so run_frontend_only's `pnpm dev` tail is a no-op in tests.
  STUB_PNPM="$TEST_DIR/bin-pnpm"
  mkdir -p "$STUB_PNPM"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$STUB_PNPM/pnpm"

  chmod +x "$STUB_PONG/redis-cli" "$STUB_BAD/redis-cli" "$STUB_PNPM/pnpm"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# --- redis_listener_is_usable() ---

# @scenario "redis-cli PONG reply means the listener is a usable local Redis"
@test "redis_listener_is_usable: PONG reply -> usable" {
  run bash -c '
    scripts_dir="$1"; stub_bin="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$stub_bin:$PATH"
    redis_listener_is_usable
  ' _ "$SCRIPT_DIR" "$STUB_PONG"
  [ "$status" -eq 0 ]
}

# @scenario "a listener that does not reply PONG is not a usable Redis"
@test "redis_listener_is_usable: non-PONG reply -> not usable" {
  run bash -c '
    scripts_dir="$1"; stub_bin="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$stub_bin:$PATH"
    redis_listener_is_usable
  ' _ "$SCRIPT_DIR" "$STUB_BAD"
  [ "$status" -ne 0 ]
}

# @scenario "absent redis-cli degrades gracefully to not-usable (no crash)"
@test "redis_listener_is_usable: redis-cli absent -> not usable" {
  run bash -c '
    scripts_dir="$1"; empty_dir="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$empty_dir"
    redis_listener_is_usable
  ' _ "$SCRIPT_DIR" "$EMPTY_DIR"
  [ "$status" -ne 0 ]
}

# --- run_frontend_only() redis branch ---

# @scenario "frontend-only reuses a verified usable Redis without starting a container"
@test "run_frontend_only: usable redis on 6379 -> reuse, no container start" {
  run bash -c '
    scripts_dir="$1"; workdir="$2"; stub_pnpm="$3"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 0; }
    redis_listener_is_usable() { return 0; }
    write_overrides() { :; }
    COMPOSE="echo __COMPOSE_CALLED__"
    PATH="$stub_pnpm:$PATH"
    cd "$workdir" || exit 91
    run_frontend_only
  ' _ "$SCRIPT_DIR" "$WORKDIR" "$STUB_PNPM"
  [ "$status" -eq 0 ]
  [[ "$output" == *"reusing it for in-process workers"* ]]
  [[ "$output" != *"__COMPOSE_CALLED__"* ]]
  [[ "$output" != *"Starting: redis compose service"* ]]
}

# @scenario "frontend-only errors out when 6379 is occupied by an unusable listener"
@test "run_frontend_only: non-usable listener on 6379 -> error + non-zero exit, no container start" {
  run bash -c '
    scripts_dir="$1"; workdir="$2"; stub_pnpm="$3"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 0; }
    redis_listener_is_usable() { return 1; }
    write_overrides() { :; }
    COMPOSE="echo __COMPOSE_CALLED__"
    PATH="$stub_pnpm:$PATH"
    cd "$workdir" || exit 91
    run_frontend_only
  ' _ "$SCRIPT_DIR" "$WORKDIR" "$STUB_PNPM"
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not be verified as a usable"* ]]
  [[ "$output" != *"__COMPOSE_CALLED__"* ]]
}

# @scenario "frontend-only starts its own redis container when 6379 is free"
@test "run_frontend_only: port 6379 free -> starts redis container" {
  run bash -c '
    scripts_dir="$1"; workdir="$2"; stub_pnpm="$3"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 1; }
    redis_listener_is_usable() { return 1; }
    write_overrides() { :; }
    COMPOSE="echo __COMPOSE_CALLED__"
    PATH="$stub_pnpm:$PATH"
    cd "$workdir" || exit 91
    run_frontend_only
  ' _ "$SCRIPT_DIR" "$WORKDIR" "$STUB_PNPM"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Starting: redis compose service"* ]]
  [[ "$output" == *"__COMPOSE_CALLED__ up -d redis"* ]]
}

# --- check_host_redis_collision() (container-preset pre-flight guard) ---
#
# Why these exist: check_host_redis_collision used to hard-fail whenever
# *anything* held host port 6379. That false-positives on the common case of
# re-running quickstart against an already-up stack — the compose `redis`
# service binds 6379:6379, so our own running container owns the port even
# though `docker compose up` would idempotently reuse it. The guard now exempts
# this project's own redis container and only errors on a foreign listener.

# @scenario "an explicit SKIP flag short-circuits the guard"
@test "check_host_redis_collision: SKIP_HOST_REDIS_CHECK=1 -> returns 0" {
  run bash -c '
    scripts_dir="$1"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 0; }
    redis_6379_owned_by_this_project() { return 1; }
    SKIP_HOST_REDIS_CHECK=1 check_host_redis_collision
  ' _ "$SCRIPT_DIR"
  [ "$status" -eq 0 ]
}

# @scenario "port 6379 free -> guard passes (own redis container will start)"
@test "check_host_redis_collision: 6379 free -> returns 0" {
  run bash -c '
    scripts_dir="$1"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 1; }
    redis_6379_owned_by_this_project() { return 1; }
    check_host_redis_collision
  ' _ "$SCRIPT_DIR"
  [ "$status" -eq 0 ]
}

# @scenario "this project's own running redis on 6379 is reused, not rejected"
@test "check_host_redis_collision: own redis container on 6379 -> returns 0, no error" {
  run bash -c '
    scripts_dir="$1"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 0; }
    redis_6379_owned_by_this_project() { return 0; }
    check_host_redis_collision
  ' _ "$SCRIPT_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" != *"already listening on host port 6379"* ]]
}

# @scenario "a foreign (non-Docker) listener on 6379 still fails loudly"
@test "check_host_redis_collision: foreign listener on 6379 -> error + exit 1" {
  run bash -c '
    scripts_dir="$1"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    redis_port_in_use() { return 0; }
    redis_6379_owned_by_this_project() { return 1; }
    check_host_redis_collision
  ' _ "$SCRIPT_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not"*"this dev stack"*"own redis container"* ]]
  [[ "$output" == *"SKIP_HOST_REDIS_CHECK=1"* ]]
}

# --- redis_6379_owned_by_this_project() ---

# @scenario "absent docker degrades to not-owned (no crash, falls through to guard)"
@test "redis_6379_owned_by_this_project: docker absent -> not owned" {
  run bash -c '
    scripts_dir="$1"; empty_dir="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$empty_dir"
    redis_6379_owned_by_this_project
  ' _ "$SCRIPT_DIR" "$EMPTY_DIR"
  [ "$status" -ne 0 ]
}

# @scenario "a container publishing host 6379 under THIS compose project is owned"
@test "redis_6379_owned_by_this_project: matching compose project -> owned" {
  STUB_DOCKER="$TEST_DIR/bin-docker-match"
  mkdir -p "$STUB_DOCKER"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'case "$*" in' \
    '  *"ps -q --filter publish=6379"*) echo cidA ;;' \
    '  *"inspect"*"compose.project"*) echo my-worktree ;;' \
    '  *) ;;' \
    'esac' > "$STUB_DOCKER/docker"
  chmod +x "$STUB_DOCKER/docker"
  run bash -c '
    scripts_dir="$1"; stub="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$stub:$PATH"
    COMPOSE_PROJECT_NAME=my-worktree redis_6379_owned_by_this_project
  ' _ "$SCRIPT_DIR" "$STUB_DOCKER"
  [ "$status" -eq 0 ]
}

# @scenario "a container publishing host 6379 under ANOTHER project is not owned"
@test "redis_6379_owned_by_this_project: foreign compose project -> not owned" {
  STUB_DOCKER="$TEST_DIR/bin-docker-foreign"
  mkdir -p "$STUB_DOCKER"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'case "$*" in' \
    '  *"ps -q --filter publish=6379"*) echo cidA ;;' \
    '  *"inspect"*"compose.project"*) echo some-other-app ;;' \
    '  *) ;;' \
    'esac' > "$STUB_DOCKER/docker"
  chmod +x "$STUB_DOCKER/docker"
  run bash -c '
    scripts_dir="$1"; stub="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$stub:$PATH"
    COMPOSE_PROJECT_NAME=my-worktree redis_6379_owned_by_this_project
  ' _ "$SCRIPT_DIR" "$STUB_DOCKER"
  [ "$status" -ne 0 ]
}

# @scenario "nothing publishing host 6379 -> not owned (e.g. stray redis on another host port)"
@test "redis_6379_owned_by_this_project: no publisher on 6379 -> not owned" {
  STUB_DOCKER="$TEST_DIR/bin-docker-none"
  mkdir -p "$STUB_DOCKER"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    '# ps returns nothing; any inspect returns nothing' \
    'exit 0' > "$STUB_DOCKER/docker"
  chmod +x "$STUB_DOCKER/docker"
  run bash -c '
    scripts_dir="$1"; stub="$2"
    set --
    cd "$scripts_dir" || exit 90
    source ./dev.sh
    PATH="$stub:$PATH"
    COMPOSE_PROJECT_NAME=my-worktree redis_6379_owned_by_this_project
  ' _ "$SCRIPT_DIR" "$STUB_DOCKER"
  [ "$status" -ne 0 ]
}
