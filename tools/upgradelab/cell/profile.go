package cell

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

// Profile is one deployment of the matrix (plan section 2.1): which shape env it boots with, what it
// adds on top, and what it still lacks. Which tenants sit on a private target is the shape's (seed).
type Profile struct {
	Shape   string
	Extra   map[string]string
	Missing string // non-empty: the profile cannot run yet, and why
	// StopStart: one instance, so the old release stops before head starts; else a rolling deploy.
	StopStart bool
	// Objects: the cell runs its own S3 (storagesim), shared and one per private object target.
	Objects bool
	// NoAdminEmails: the operator never set ADMIN_EMAILS (plan section 7.1, sh-free's second variant).
	NoAdminEmails bool
	// SSO: the cell runs its own idpsim and the deployment signs in through it (E6).
	SSO bool
}

// Profiles are the deployments a cell runs; a new deployment is one entry here.
var Profiles = map[string]Profile{
	"cloud":  {Shape: "saas", Extra: cloudBilling},
	"hybrid": {Shape: "hybrid", Extra: cloudBilling, Objects: true},
	// Cloud with main's instance-wide sign-in (NEXTAUTH_PROVIDER) on the cell's idpsim; passwords kept for the seed account.
	"cloud-sso": {Shape: "saas", Extra: cloudBilling, SSO: true},
	// Self-hosted from origin/main like the others; 3.20.1 stays a cell of its own (-from-dir a 3.20.1 tree).
	"self-hosted":      {Shape: "sh-licensed", StopStart: true},
	"self-hosted-free": {Shape: "sh-free", StopStart: true}, // the ADMIN_EMAILS-unset variant sets NoAdminEmails on it
}

// cloudBilling: main's SaaS runtime refuses to boot without a Stripe key; this one never reaches Stripe.
var cloudBilling = map[string]string{"STRIPE_SECRET_KEY": "sk_test_upgradelab_never_sent"}

// Tiers and shapes a cell accepts today; L and XL wait for the scale generator (lane L4).
var (
	Tiers      = []string{"S", "M"}
	DataShapes = []string{"typical"}
)

// processKeys are the only parent variables a child sees: never a provider key or a store URL.
var processKeys = []string{"PATH", "HOME", "USER", "TMPDIR", "LANG", "SHELL"}

// EnvInput is what a release's processes share: the profile, the stores and the public address.
type EnvInput struct {
	Profile Profile
	Stores  Stores
	APIPort int
	Admin   string
}

// BuildEnv is the whole environment of every process in a cell, both releases alike.
func BuildEnv(input EnvInput) (map[string]string, error) {
	origin := "http://127.0.0.1:" + strconv.Itoa(input.APIPort) // main realigns a localhost origin to its PORT (alignDevAuthUrlsToPort)
	operator, err := OperatorEnv(input.Profile, origin, input.Admin)
	if err != nil {
		return nil, err
	}
	env := map[string]string{}
	for _, key := range processKeys {
		if value, ok := os.LookupEnv(key); ok {
			env[key] = value
		}
	}
	maps.Copy(env, operator)
	maps.Copy(env, map[string]string{
		"NODE_ENV": "production", "SKIP_ENV_VALIDATION": "true", // as the release image sets them
		"pnpm_config_verify_deps_before_run": "false", "CHECKPOINT_DISABLE": "1",
		"DATABASE_URL": input.Stores.DatabaseURL(), "CLICKHOUSE_URL": input.Stores.ClickHouseURL(""),
		"REDIS_URL": input.Stores.RedisURL(), "REDIS_DB_INDEX": "0", "LANGWATCH_ENDPOINT": origin,
		"LANGWATCH_NLP_SERVICE": "http://127.0.0.1:9", "HAVEN_SEED_MODEL_PROVIDERS": "0",
	})
	shape, err := seed.LoadShapeEnv(input.Profile.Shape)
	if err != nil {
		return nil, err
	}
	routePrivateTargets(env, input.Stores, shape.PrivateTargets())
	routeObjects(env, input.Stores, shape.PrivateObjectTargets())
	routeIdentityProvider(env, input.Stores)
	return env, nil
}

// OperatorEnv is what an operator's own .env holds for the profile: shape values and secrets, the
// public origin, and ADMIN_EMAILS with admin added (or no ADMIN_EMAILS at all). No store URL.
func OperatorEnv(profile Profile, origin, admin string) (map[string]string, error) {
	shape, err := seed.LoadShapeEnv(profile.Shape)
	if err != nil {
		return nil, err
	}
	env := map[string]string{}
	maps.Copy(env, shape.Values)
	maps.Copy(env, shape.Secrets)
	maps.Copy(env, profile.Extra)
	maps.Copy(env, map[string]string{"BASE_HOST": origin, "NEXTAUTH_URL": origin, "ADMIN_EMAILS": adminEmails(env["ADMIN_EMAILS"], admin)})
	if profile.NoAdminEmails {
		delete(env, "ADMIN_EMAILS")
	}
	return env, nil
}

func adminEmails(existing, admin string) string {
	emails := slices.DeleteFunc(strings.Split(existing, ","), func(email string) bool { return email == "" })
	return strings.Join(append(emails, admin), ",")
}

// routePrivateTargets drops the shape file's compose-network URLs and routes each organization to its cell database.
func routePrivateTargets(env map[string]string, stores Stores, targets map[string]string) {
	for key := range env {
		if strings.HasPrefix(key, "CLICKHOUSE_URL__") || strings.HasPrefix(key, "DATAPLANE_S3__") {
			delete(env, key)
		}
	}
	for label, organization := range targets {
		env["CLICKHOUSE_URL__"+label+"__"+organization] = stores.ClickHouseURL(label)
	}
}

// routeObjects points the shared S3 settings and each private organization's account at the cell's storagesims.
func routeObjects(env map[string]string, stores Stores, targets map[string]string) {
	if _, ok := stores.S3[""]; !ok {
		return
	}
	shared := stores.ObjectAccount("")
	maps.Copy(env, map[string]string{"STORED_OBJECTS_BACKEND": "s3", "S3_ENDPOINT": shared.Endpoint, "S3_BUCKET_NAME": shared.Bucket,
		"S3_ACCESS_KEY_ID": shared.AccessKeyID, "S3_SECRET_ACCESS_KEY": shared.SecretAccessKey, "S3_REGION": "auto"})
	for label, organization := range targets {
		if _, ok := stores.S3[label]; ok {
			account, _ := json.Marshal(stores.ObjectAccount(label))
			env["DATAPLANE_S3__"+label+"__"+organization] = string(account)
		}
	}
}

// routeIdentityProvider is idpsim's own `legacy env` for a generic tenant: main's NEXTAUTH_PROVIDER, which head
// still applies (deprecated), so the operator's .env stays as it was across the upgrade.
func routeIdentityProvider(env map[string]string, stores Stores) {
	if stores.IDP == 0 {
		return
	}
	idp := stores.IDPURL()
	maps.Copy(env, map[string]string{"NEXTAUTH_PROVIDER": "oidc", "OIDC_ISSUER": idp + "/t/" + ssoTenant, "OIDC_CLIENT_ID": "langwatch-upgradelab",
		"OIDC_CLIENT_SECRET": "idpsim-accepts-any-secret-for-an-unregistered-client", "LOCAL_PASSWORDS_ENABLED": "on", "SSO_TRUSTED_IDP_ORIGINS": idp})
	// The operator's lever for self-serve SSO setup (E7), read by both releases.
	env["FEATURE_FLAG_FORCE_ENABLE"] = strings.Trim(env["FEATURE_FLAG_FORCE_ENABLE"]+",self_serve_sso", ",")
}

// CheckSourceDir refuses a release directory holding a .env: both releases read one when it exists.
func CheckSourceDir(dir string) error {
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err != nil {
		return fmt.Errorf("%s is not a checkout: %w", dir, err)
	}
	for _, candidate := range []string{".env", "platform/app/.env", "apps/api/.env", "apps/worker/.env", "apps/tasks/.env"} {
		if _, err := os.Stat(filepath.Join(dir, candidate)); err == nil {
			return fmt.Errorf("refusing %s: it holds %s, which the release would read; remove it (worktree hooks copy the root .env in)", dir, candidate)
		}
	}
	return nil
}
