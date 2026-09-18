#!/usr/bin/env node
// Postinstall for the claude wrapper package (name in ./package.json).
//
// Detects the platform, finds the matching native binary from optionalDependencies,
// and copies it over the bin/claude.exe placeholder. After this runs, `claude` execs
// the native binary directly — no Node.js process stays resident.
//
// If the native package isn't present (--omit=optional), prints instructions and
// leaves the placeholder stub in place. cli-wrapper.cjs (same directory) can be
// invoked manually as a fallback that keeps working via require.resolve + spawn.
//
// Platform detection + PLATFORMS map is duplicated in cli-wrapper.cjs — keep in sync.

const { spawnSync } = require('child_process')
const {
  copyFileSync,
  linkSync,
  unlinkSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  statSync,
} = require('fs')
const { arch } = require('os')
const path = require('path')

// Replaced at build time via sed. Keep the literals below as markers.
const PACKAGE_PREFIX = '@anthropic-ai/claude-code'
const BINARY_NAME = 'claude'
const WRAPPER_NAME = require('./package.json').name

const PLATFORMS = {
  'darwin-arm64': { pkg: PACKAGE_PREFIX + '-darwin-arm64', bin: BINARY_NAME },
  'darwin-x64': { pkg: PACKAGE_PREFIX + '-darwin-x64', bin: BINARY_NAME },
  'linux-x64': { pkg: PACKAGE_PREFIX + '-linux-x64', bin: BINARY_NAME },
  'linux-arm64': { pkg: PACKAGE_PREFIX + '-linux-arm64', bin: BINARY_NAME },
  'linux-x64-musl': {
    pkg: PACKAGE_PREFIX + '-linux-x64-musl',
    bin: BINARY_NAME,
  },
  'linux-arm64-musl': {
    pkg: PACKAGE_PREFIX + '-linux-arm64-musl',
    bin: BINARY_NAME,
  },
  'linux-arm64-android': {
    pkg: PACKAGE_PREFIX + '-linux-arm64-android',
    bin: BINARY_NAME,
  },
  'linux-x64-android': {
    pkg: PACKAGE_PREFIX + '-linux-x64-android',
    bin: BINARY_NAME,
  },
  'win32-x64': {
    pkg: PACKAGE_PREFIX + '-win32-x64',
    bin: BINARY_NAME + '.exe',
  },
  'win32-arm64': {
    pkg: PACKAGE_PREFIX + '-win32-arm64',
    bin: BINARY_NAME + '.exe',
  },
}

function detectMusl() {
  if (process.platform !== 'linux') {
    return false
  }
  // process.report is available in Node ≥12; glibcVersionRuntime is absent on musl.
  // Faster than spawning `ldd` and avoids the ENOENT→musl false positive when ldd
  // isn't on PATH (minimal containers).
  const report =
    typeof process.report?.getReport === 'function'
      ? process.report.getReport()
      : null
  return report != null && report.header?.glibcVersionRuntime === undefined
}

function getPlatformKey() {
  const platform = process.platform
  let cpu = arch()
  if (platform === 'android') {
    return 'linux-' + cpu + '-android'
  }
  if (platform === 'linux') {
    return 'linux-' + cpu + (detectMusl() ? '-musl' : '')
  }
  // Rosetta 2: an x64 Node on Apple Silicon reports arch()==='x64'. Prefer the
  // native arm64 binary — the x64 build needs AVX, which Rosetta doesn't emulate.
  if (platform === 'darwin' && cpu === 'x64') {
    const r = spawnSync('sysctl', ['-n', 'sysctl.proc_translated'], {
      encoding: 'utf8',
    })
    if (r.stdout?.trim() === '1') {
      cpu = 'arm64'
    }
  }
  return platform + '-' + cpu
}

function placeBinary(src, dest) {
  // Try hardlink first (instant, zero extra disk for a ~500MB binary; src and
  // dest are both under node_modules/ so same-filesystem is the common case).
  // We attempt the link BEFORE touching dest — if src is missing (partial
  // extraction) the first linkSync throws ENOENT and the fallback stub stays.
  try {
    linkSync(src, dest)
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Read the stub before unlinking so we can restore it if both link and
      // copy fail (ENOSPC, NFS error mid-500MB-copy). Only read if dest is
      // stub-sized — on re-install dest is the ~500MB binary.
      const stub = statSync(dest).size < 4096 ? readFileSync(dest) : null
      unlinkSync(dest)
      try {
        linkSync(src, dest)
      } catch {
        try {
          copyFileSync(src, dest)
        } catch (copyErr) {
          if (stub) {
            try {
              writeFileSync(dest, stub, { mode: 0o755 })
            } catch {
              // Do nothing
            }
          }
          throw copyErr
        }
      }
    } else if (err.code === 'EXDEV' || err.code === 'EPERM') {
      // Cross-device or no-link-perms — copyFileSync overwrites existing dest.
      copyFileSync(src, dest)
    } else {
      throw err
    }
  }
  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }
}

function main() {
  const platformKey = getPlatformKey()
  const info = PLATFORMS[platformKey]

  if (!info) {
    console.error(
      `[${WRAPPER_NAME} postinstall] Unsupported platform: ${process.platform} ${arch()}`,
    )
    console.error(`  Supported: ${Object.keys(PLATFORMS).join(', ')}`)
    if (process.platform === 'freebsd') {
      console.error(
        '  FreeBSD is not natively supported on this version of Claude Code. Consider running under Linuxulator.',
      )
    }
    return
  }

  const optionalDeps = require('./package.json').optionalDependencies || {}
  if (!optionalDeps[info.pkg]) {
    console.error(
      `[${WRAPPER_NAME} postinstall] Native binaries for ${platformKey} are not available on this release channel.`,
    )
    console.error(
      `  Available: ${Object.keys(optionalDeps)
        .map(p => p.replace(PACKAGE_PREFIX + '-', ''))
        .join(', ')}`,
    )
    return
  }

  let src
  try {
    const pkgDir = path.dirname(require.resolve(info.pkg + '/package.json'))
    src = path.join(pkgDir, info.bin)
  } catch {
    console.error(
      `[${WRAPPER_NAME} postinstall] Native package "${info.pkg}" not found.`,
    )
    if (platformKey === 'darwin-arm64' && arch() === 'x64') {
      console.error(
        '  You are running x64 Node under Rosetta 2 on Apple Silicon. npm only',
      )
      console.error(
        '  installed the darwin-x64 binary, which requires AVX (not emulated by',
      )
      console.error(
        '  Rosetta). Install arm64 Node and reinstall — e.g. via nvm:',
      )
      console.error(
        '    arch -arm64 zsh -c "nvm install --lts && npm i -g ' +
          WRAPPER_NAME +
          '"',
      )
      return
    }
    console.error(
      '  This happens with --omit=optional or when the download failed.',
    )
    console.error(
      '  The `claude` command will print instructions when invoked.',
    )
    console.error('  Fallback: node ' + path.join(__dirname, 'cli-wrapper.cjs'))
    return
  }

  // Always write to bin/claude.exe — the package.json bin field points here.
  // The .exe extension + no-shebang stub makes npm's cmd-shim (generated at
  // install time, before postinstall) emit a direct exec on Windows; Unix
  // ignores the extension. Same pattern as Bun's npm package.
  const dest = path.join(__dirname, 'bin', 'claude.exe')

  try {
    placeBinary(src, dest)
  } catch (err) {
    console.error(
      `[${WRAPPER_NAME} postinstall] Failed to place binary: ${err.message}`,
    )
    console.error('  Fallback: node ' + path.join(__dirname, 'cli-wrapper.cjs'))
    process.exitCode = 1
  }
}

main()
