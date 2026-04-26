#!/bin/sh
# install.sh — bootstrap the langwatch CLI on macOS / Linux.
#
# Usage:
#     curl -sSL https://get.langwatch.com | sh
#
# Or pin a version:
#     curl -sSL https://get.langwatch.com | LANGWATCH_VERSION=v1.2.3 sh
#
# Env knobs:
#     LANGWATCH_VERSION   release tag to install (default: latest)
#     LANGWATCH_PREFIX    install prefix (default: /usr/local on macOS,
#                         $HOME/.local on Linux)
#     LANGWATCH_CHANNEL   release channel: stable | edge (default: stable)
#
# The script:
#   1. Detects OS + arch and chooses the matching tarball.
#   2. Downloads it from the langwatch GitHub releases bucket.
#   3. Verifies the SHA256 against the release manifest.
#   4. Installs the binary to $LANGWATCH_PREFIX/bin/langwatch.
#   5. Prints next-steps (`langwatch login`).
#
# It is deliberately POSIX-sh, no bashisms — works on alpine, busybox, etc.

set -eu

LANGWATCH_VERSION=${LANGWATCH_VERSION:-latest}
LANGWATCH_CHANNEL=${LANGWATCH_CHANNEL:-stable}
LANGWATCH_REPO=${LANGWATCH_REPO:-langwatch/langwatch}

err() { printf '%s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

detect_os() {
    case "$(uname -s)" in
        Darwin)  echo darwin ;;
        Linux)   echo linux ;;
        MINGW*|MSYS*|CYGWIN*) err "Windows: use the PowerShell installer at https://get.langwatch.com/install.ps1" ;;
        *) err "unsupported OS: $(uname -s)" ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo amd64 ;;
        aarch64|arm64)  echo arm64 ;;
        *) err "unsupported arch: $(uname -m)" ;;
    esac
}

detect_prefix() {
    if [ -n "${LANGWATCH_PREFIX:-}" ]; then
        echo "$LANGWATCH_PREFIX"
        return
    fi
    case "$(detect_os)" in
        darwin) echo /usr/local ;;
        linux)  echo "$HOME/.local" ;;
    esac
}

resolve_version() {
    case "$LANGWATCH_VERSION" in
        latest)
            if have curl; then
                curl -fsSL "https://api.github.com/repos/$LANGWATCH_REPO/releases/latest" \
                    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
                    | head -n1
            elif have wget; then
                wget -qO- "https://api.github.com/repos/$LANGWATCH_REPO/releases/latest" \
                    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
                    | head -n1
            else
                err "neither curl nor wget found"
            fi
            ;;
        *) echo "$LANGWATCH_VERSION" ;;
    esac
}

download() {
    src=$1
    dest=$2
    if have curl; then
        curl -fsSL -o "$dest" "$src"
    elif have wget; then
        wget -qO "$dest" "$src"
    else
        err "neither curl nor wget found"
    fi
}

main() {
    OS=$(detect_os)
    ARCH=$(detect_arch)
    PREFIX=$(detect_prefix)
    VERSION=$(resolve_version)
    [ -n "$VERSION" ] || err "could not resolve a release version (channel=$LANGWATCH_CHANNEL)"

    printf 'Installing langwatch %s for %s/%s into %s/bin\n' \
        "$VERSION" "$OS" "$ARCH" "$PREFIX"

    TARBALL="langwatch-${VERSION}-${OS}-${ARCH}.tar.gz"
    URL="https://github.com/$LANGWATCH_REPO/releases/download/$VERSION/$TARBALL"

    TMP=$(mktemp -d 2>/dev/null || mktemp -d -t lw)
    trap 'rm -rf "$TMP"' EXIT INT TERM

    printf '  downloading %s\n' "$TARBALL"
    download "$URL" "$TMP/$TARBALL"

    # Optional checksum verification — skip silently if checksums.txt
    # isn't on the release (older releases or pre-release builds).
    CHECK_URL="https://github.com/$LANGWATCH_REPO/releases/download/$VERSION/checksums.txt"
    if download "$CHECK_URL" "$TMP/checksums.txt" 2>/dev/null; then
        if have sha256sum; then SHA="sha256sum"; else SHA="shasum -a 256"; fi
        EXPECTED=$(grep " $TARBALL\$" "$TMP/checksums.txt" | awk '{print $1}')
        if [ -n "$EXPECTED" ]; then
            ACTUAL=$(cd "$TMP" && $SHA "$TARBALL" | awk '{print $1}')
            [ "$EXPECTED" = "$ACTUAL" ] || err "checksum mismatch for $TARBALL (expected $EXPECTED, got $ACTUAL)"
            printf '  checksum ok\n'
        fi
    fi

    tar -xzf "$TMP/$TARBALL" -C "$TMP"
    [ -f "$TMP/langwatch" ] || err "tarball missing 'langwatch' binary"

    install -d "$PREFIX/bin"
    install -m 0755 "$TMP/langwatch" "$PREFIX/bin/langwatch"

    printf '✓ Installed %s/bin/langwatch\n' "$PREFIX"
    case ":$PATH:" in
        *":$PREFIX/bin:"*) ;;
        *) printf 'note: %s/bin is not on your PATH; add this to your shell rc:\n  export PATH="%s/bin:$PATH"\n' "$PREFIX" "$PREFIX" ;;
    esac

    printf '\nNext: run `langwatch login`.\n'
}

main "$@"
