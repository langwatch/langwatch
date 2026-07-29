package domain

// Static local dev identity haven injects into every worktree, matching
// langwatch/prisma/seed.ts exactly (keep the two in sync by hand — they
// intentionally can't share a constant across the Go/TS boundary). See that
// file's header comment for the full rationale and how each value maps onto
// this codebase's real Organization/Project/User/ApiKey model.
//
// DefaultLocalAPIKey (the ingestion key) lives in overlay.go, predating this
// file; it is included in the doc set below for completeness.
const (
	// DefaultAdminEmail/DefaultAdminPassword are the seeded BetterAuth
	// credential login every worktree and every agent can sign in with.
	DefaultAdminEmail    = "admin@haven.localhost"
	DefaultAdminPassword = "LocalHavenAdmin!2026"

	// DefaultPrivateAccessToken is a full-access personal access token
	// (ORGANIZATION-scope ADMIN), the ApiKey-table equivalent of a GitHub PAT.
	DefaultPrivateAccessToken = "sk-lw-LocalDevPrivate1_LocalDevPrivateAccessTokenSecretFixedValue000000"

	// DefaultPublicAccessToken is an ingestion-only token (PROJECT-scope,
	// traces:create only) — the least-privileged key type this codebase has;
	// there is no true client-safe/publishable-key concept here.
	DefaultPublicAccessToken = "ik-lw-LocalDevPublicIk_LocalDevPublicIngestionTokenSecretFixedValue0000"
)
