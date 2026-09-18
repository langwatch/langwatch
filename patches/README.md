The patch only exposes a custom OIDC fetch transport. LangWatch uses it for
deployment-specific egress restrictions; Better Auth remains responsible for
origin, endpoint, state, PKCE, and redirect validation.
