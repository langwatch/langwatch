# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.2](https://github.com/langwatch/ksuid/compare/ksuid-javascript/v2.0.1...ksuid-javascript/v2.0.2) (2025-11-13)

### Bug Fixes

- esm package was broken ([#5](https://github.com/langwatch/ksuid/issues/5)) ([a55e576](https://github.com/langwatch/ksuid/commit/a55e576e0ea62cc0d41f3003f4262956cb4d7e6b))

## [2.0.1](https://github.com/langwatch/ksuid/compare/ksuid-javascript/v2.0.0...ksuid-javascript/v2.0.1) (2025-11-12)

### Bug Fixes

- release please ([#2](https://github.com/langwatch/ksuid/issues/2)) ([dff78d7](https://github.com/langwatch/ksuid/commit/dff78d718bebcdc7a31404cbce279c103afda19e))

## [2.0.0] - 2024-01-15

### Added

- Complete TypeScript rewrite with strict typing
- Zero-dependency implementation (removed base-x dependency)
- Cross-platform support (Node.js, Browser, Bun, Deno)
- Modern ES modules with proper exports
- Comprehensive test suite with vitest
- GitHub Actions CI/CD pipeline
- Automatic instance detection for Docker containers
- Environment-aware KSUID generation
- Advanced API with factory pattern
- Full TypeScript declarations
- Comprehensive documentation

### Changed

- **BREAKING**: Package renamed from `@cuvva/ksuid` to `@langwatch/ksuid`
- **BREAKING**: API changed to use named exports instead of default export
- **BREAKING**: Environment and instance management now uses getter/setter functions
- **BREAKING**: Removed CommonJS support in favor of ES modules
- **BREAKING**: Minimum Node.js version is now 20+
- **BREAKING**: Removed legacy compatibility exports (`environment`, `instance` properties)
- Improved error handling with specific error types
- Better performance with optimized base62 implementation
- Enhanced platform detection and crypto provider selection

### Removed

- CommonJS module support
- Travis CI in favor of GitHub Actions
- Tape testing framework in favor of vitest
- Istanbul coverage in favor of v8 coverage
- Legacy browser polyfills
- Legacy compatibility exports (`environment`, `instance` properties)

### Fixed

- Circular dependency issues
- Platform detection bugs
- Memory leaks in buffer handling
- Type safety issues
- Cross-platform compatibility problems
- TypeScript linter errors and type declarations

## [1.0.2] - 2020-01-01

### Fixed

- Various bug fixes and improvements

## [1.0.1] - 2019-01-01

### Fixed

- Initial release fixes

## [1.0.0] - 2018-01-01

### Added

- Initial release
- Basic KSUID generation and parsing
- Environment support
- Instance detection
