# Managed Model Provider Components

This directory contains reference implementations for components used in the SaaS version of LangWatch via dependency injection.

## Bug Fix #0913

**Issue**: Grammar error in managed model provider credentials alert message

**Error**: "The bedrock provider credentials **is** managed by LangWatch for your organization."

**Fix**: Changed to "The bedrock provider credentials **are** managed by LangWatch for your organization."

### Implementation Details

The managed model provider component is injected via the dependency injection system defined in:
- `next.config.mjs` (lines 119-122): Aliases `@injected-dependencies.client` to `injection.client.ts`
- `src/injection/injection.client.ts`: Exports the `Dependencies` interface
- The actual SaaS implementation should be in the `saas-src` directory (not in OSS repo)

### Files to Update in SaaS Repository

The managed model provider component that needs to be fixed is likely located at:
- `saas-src/injection/components/ManagedModelProvider.tsx` (or similar path)

The component should:
1. Check if `provider.customKeys.MANAGED` is set
2. Display an Alert with the **corrected** message: "The {provider} provider credentials **are** managed by LangWatch for your organization."

### Reference Implementation

See `ManagedModelProviderAlert.tsx` in this directory for a complete reference implementation with the correct grammar.
