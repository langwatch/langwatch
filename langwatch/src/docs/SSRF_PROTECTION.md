# HTTP Proxy SSRF Protection

## Overview

The HTTP proxy router (`src/server/api/routers/httpProxy.ts`) implements Server-Side Request Forgery (SSRF) protection to prevent attackers from accessing internal resources.

## What is Protected

### Always Blocked (All Environments)
- **Cloud metadata endpoints**: `169.254.169.254`, `metadata.google.internal`, `fd00:ec2::254`
  - These provide access to cloud instance credentials and sensitive data
  - Blocking these is critical for cloud security

### Blocked in Production
- **Loopback addresses**: `127.0.0.0/8`, `::1`, `0.0.0.0`
- **Private IP ranges**:
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
- **Link-local addresses**: `169.254.0.0/16`, `fe80::/10`
- **Hostnames resolving to private IPs**

## Development Mode

### Default Behavior (No Allowlist)
When `ALLOWED_PROXY_HOSTS` is not set or empty:
- All localhost and private IP requests are allowed
- Cloud metadata endpoints remain blocked
- Suitable for local development

### Explicit Allowlist (Recommended)
Set `ALLOWED_PROXY_HOSTS` environment variable with comma-separated hostnames:

```bash
ALLOWED_PROXY_HOSTS=localhost,127.0.0.1,host.docker.internal,192.168.1.100
```

With an allowlist configured:
- Only listed hosts bypass SSRF checks
- All other hosts go through full SSRF validation
- Provides stricter security during development

## Implementation Details

### Validation Steps
1. **Parse URL**: Validate URL format
2. **Metadata check**: Block cloud metadata endpoints (all environments)
3. **Allowlist check**: If in dev + allowlist configured, check if host is allowed
4. **IP validation**: 
   - For literal IPs: Check against private/localhost ranges
   - For hostnames: Resolve DNS (A + AAAA records) and check all IPs
5. **DNS failures**: Non-blocking (let fetch handle actual network errors)

### Logging
All SSRF attempts are logged with context:
- **Blocked attempts**: `logger.warn()` with URL, hostname, reason
- **Allowed dev requests**: `logger.info()` with allowlist context
- **DNS failures**: `logger.debug()` for troubleshooting

### Error Messages
User-friendly error messages returned to frontend:
- "Access to cloud metadata endpoints is not allowed for security reasons"
- "Access to private or localhost IP addresses is not allowed for security reasons"
- "This hostname resolves to a private or localhost IP address, which is not allowed for security reasons"

## Testing

### Test Blocked Requests (Production)
```bash
# Should be blocked
curl -X POST /api/trpc/httpProxy.execute -d '{"url": "http://169.254.169.254/latest/meta-data/"}'
curl -X POST /api/trpc/httpProxy.execute -d '{"url": "http://localhost:5432/"}'
curl -X POST /api/trpc/httpProxy.execute -d '{"url": "http://10.0.0.1/"}'
```

### Test Allowed Requests (Development with Allowlist)
```bash
# Set allowlist
export ALLOWED_PROXY_HOSTS=localhost,127.0.0.1

# Should be allowed
curl -X POST /api/trpc/httpProxy.execute -d '{"url": "http://localhost:3000/api/test"}'

# Should be blocked (not in allowlist)
curl -X POST /api/trpc/httpProxy.execute -d '{"url": "http://192.168.1.1/"}'
```

## Security Considerations

### Why Localhost in Dev?
Developers often test against local services:
- `http://localhost:3000` - Next.js dev server
- `http://localhost:5432` - PostgreSQL
- `http://host.docker.internal` - Docker host

Blocking these would break legitimate development workflows.

### Production vs Development
- **Production**: Strict blocking prevents internal network access
- **Development**: Flexible to support local testing
- **Metadata**: Always blocked to prevent credential leakage

### DNS Rebinding
Current implementation has a small window for DNS rebinding attacks (check → resolve → fetch). For high-security contexts, consider:
- Re-resolving immediately before fetch
- Using a HTTP client that doesn't follow redirects
- Implementing connection-level IP filtering

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALLOWED_PROXY_HOSTS` | No | Empty | Comma-separated list of allowed hosts in development |
| `NODE_ENV` | Yes | - | `development` or `production` |

## Related Files
- Implementation: `src/server/api/routers/httpProxy.ts`
- Frontend: `src/components/agents/AgentHttpEditorDrawer.tsx`
- Test panel: `src/components/agents/http/HttpTestPanel.tsx`
