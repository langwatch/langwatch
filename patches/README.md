The `@better-auth/sso@1.7.1` patch exposes an `oidcFetch` transport option for
discovery, token exchange, userinfo and JWKS retrieval, including runtime
rediscovery and IdP-initiated sign-in.

LangWatch supplies `ee/sso/sso-oidc-fetch.ts`. It applies the existing egress
policy independently of Better Auth's browser `trustedOrigins`, pins validated
DNS addresses to the connection, and refuses redirects. Tenant registration
must not create an exemption from private-address restrictions. Explicit
operator-configured internal IdP origins retain their existing exemption.

The runtime egress tests exercise the real SSO plugin with each endpoint
refused separately and a successful public flow. Retain that coverage when
upgrading the dependency or replacing the patch with upstream support. Docker
and npm distributions must include this directory before installing packages.
