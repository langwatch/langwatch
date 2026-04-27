# Dependency Age Gates

LangWatch delays newly published dependency releases during normal resolution:

- pnpm: `minimumReleaseAge: 10080` waits 7 days before selecting npm packages.
- uv: `exclude-newer = "7 days"` waits 7 days before selecting PyPI distributions.

These settings apply to direct and transitive dependencies. They protect local
developer machines as well as automation, so do not disable them globally during
routine updates.

## Emergency Security Updates

If a 0-day or actively exploited vulnerability requires a patched package before
the 7-day window has elapsed, add a package-specific exception. Keep the
exception scoped to the affected package, update the lockfile, and remove the
exception after the patched release is older than 7 days.

Do not set the global delay to `0`, comment out the global setting, or run broad
updates while the exception is active.

### pnpm

For pnpm workspaces, add `minimumReleaseAgeExclude` beside
`minimumReleaseAge` in the relevant `pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 10080
minimumReleaseAgeExclude:
  - litellm
  - '@scope/package'
```

For standalone pnpm roots that use `.npmrc`, add the package-specific exclude
there:

```ini
minimum-release-age=10080
minimum-release-age-exclude[]=litellm
minimum-release-age-exclude[]=@scope/package
```

pnpm also supports version-scoped exceptions when the fix should be pinned to a
specific release:

```yaml
minimumReleaseAge: 10080
minimumReleaseAgeExclude:
  - litellm@1.2.3
```

Then update only the affected package in the lock root that owns the dependency:

```bash
pnpm update litellm --latest
pnpm install --lockfile-only --frozen-lockfile --ignore-scripts
```

### uv

For uv projects, use `exclude-newer-package` in the relevant `pyproject.toml`.
Package-specific exceptions require uv 0.9.25 or newer. Set the package to
`false` to exempt it from the global 7-day cutoff:

```toml
[tool.uv]
required-version = ">=0.9.25"
exclude-newer = "7 days"
exclude-newer-package = { litellm = false }
```

If the exception should allow only distributions uploaded before a specific
point in time, use an RFC 3339 timestamp instead:

```toml
[tool.uv]
required-version = ">=0.9.25"
exclude-newer = "7 days"
exclude-newer-package = { litellm = "2026-04-27T12:00:00Z" }
```

Then update only the affected package in the lock root that owns the dependency:

```bash
uv lock --upgrade-package litellm
uv lock --check
```

## Review Checklist

- The exception names only the vulnerable package family that needs the fix.
- The PR explains why the exception is needed and links the advisory.
- Lockfile changes are limited to the affected dependency graph.
- A follow-up issue or PR removes the exception after the 7-day window passes.
