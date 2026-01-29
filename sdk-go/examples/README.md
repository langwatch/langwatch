# LangWatch SDK Go Examples

Self-contained examples that demonstrate SDK features without requiring external services.

## Examples

### `filtering/`

Demonstrates all span filtering capabilities:

- **Presets**: `ExcludeHTTPRequests()`, `LangWatchOnly()`
- **Custom filters**: `Include()`, `Exclude()` with `Criteria`
- **Matchers**: `Equals`, `StartsWith`, `MatchRegex` (with case-insensitive variants)
- **Semantics**: AND between filters, OR within matchers

Run it:
```bash
cd filtering
go run main.go
```

No API keys required - uses a mock exporter to show filtering behavior.

## E2E Examples

For examples that connect to real services (OpenAI, LangWatch), see the [`e2e/`](../e2e/) directory.
