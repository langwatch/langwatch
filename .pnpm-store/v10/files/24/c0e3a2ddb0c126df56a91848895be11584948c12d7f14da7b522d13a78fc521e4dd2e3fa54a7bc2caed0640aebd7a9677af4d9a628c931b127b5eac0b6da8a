#!/usr/bin/env node
// Fallback launcher for the claude wrapper package (name in ./package.json).
//
// Normally the postinstall script copies the native binary over bin/claude.exe,
// so this file is never invoked. It exists for environments where postinstall
// doesn't run (--ignore-scripts) — users can run `node cli-wrapper.cjs` directly
// and pay the Node-process overhead as the price.

const { spawnSync } = require('child_process')
const { arch, constants } = require('os')
const path = require('path')

// Replaced at build time via sed. Keep the literals below as markers.
// Platform detection + PLATFORMS map is duplicated in install.cjs — keep in sync.
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

function getBinaryPath() {
  const platformKey = getPlatformKey()
  const info = PLATFORMS[platformKey]
  if (!info) {
    console.error(
      `[${WRAPPER_NAME}] Unsupported platform: ${process.platform} ${arch()}. Supported: ${Object.keys(PLATFORMS).join(', ')}`,
    )
    if (process.platform === 'freebsd') {
      console.error(
        '  FreeBSD is not natively supported on this version of Claude Code. Consider running under Linuxulator.',
      )
    }
    process.exit(1)
  }
  const optionalDeps = require('./package.json').optionalDependencies || {}
  if (!optionalDeps[info.pkg]) {
    console.error(
      `[${WRAPPER_NAME}] Native binaries for ${platformKey} are not available on this release channel.`,
    )
    console.error(
      `  Available: ${Object.keys(optionalDeps)
        .map(p => p.replace(PACKAGE_PREFIX + '-', ''))
        .join(', ')}`,
    )
    process.exit(1)
  }
  try {
    const pkgDir = path.dirname(require.resolve(info.pkg + '/package.json'))
    return path.join(pkgDir, info.bin)
  } catch {
    console.error(
      `[${WRAPPER_NAME}] Could not find native binary package "${info.pkg}".`,
    )
    if (platformKey === 'darwin-arm64' && arch() === 'x64') {
      console.error(
        '  You are running x64 Node under Rosetta 2 on Apple Silicon. npm only',
      )
      console.error(
        '  installed the darwin-x64 binary, which requires AVX (not emulated by',
      )
      console.error('  Rosetta). Install arm64 Node and reinstall.')
    } else {
      console.error('  Try reinstalling with: npm install')
    }
    process.exit(1)
  }
}

function main() {
  const binaryPath = getBinaryPath()
  const result = spawnSync(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_CODE_INSTALLED_VIA_NPM_WRAPPER: '1' },
  })
  if (result.error) {
    console.error(
      `[${WRAPPER_NAME}] Failed to execute native binary at ` + binaryPath,
    )
    console.error('  ' + result.error.message)
    process.exit(1)
  }
  if (result.signal) {
    // Node.js ignores some signals (e.g. SIGPIPE → SIG_IGN), so re-raising is
    // unreliable. Exit with the POSIX convention 128+signum instead.
    const signum = constants.signals[result.signal] ?? 0
    process.exit(128 + signum)
  } else {
    process.exit(result.status ?? 1)
  }
}

main()
