package cell

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
	"github.com/langwatch/langwatch/tools/upgradelab/seed"
	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

// A produce entry: the snapshot directory and what a cell needs from the producer's seed beside it.
const (
	entrySnapshot = "snapshot"
	entrySeed     = "seed-context.json"
)

// ProduceOptions are one production: the cell options it shares, and where the entry goes.
type ProduceOptions struct {
	Options
	Out   string // the entry directory; default the cache entry for CacheKey
	Force bool   // replace an existing entry
}

// seedContext is the producer's seed as a restored cell reuses it: the tenancy and the seed project.
type seedContext struct {
	Tenancy seed.Tenancy
	Product seed.ProductContext
}

// CacheKey names a production: one main commit, profile, data and recipe make one snapshot.
func CacheKey(options Options) string {
	return fmt.Sprintf("%s-%s-%s-seed%d-%s-r%d", options.Deployment, options.Tier, options.Shape, options.Seed,
		strings.ReplaceAll(options.Release, "@", "-"), seed.RecipeVersion)
}

// CacheRoot is ${XDG_CACHE_HOME:-~/.cache}/langwatch/upgrade-snapshots.
func CacheRoot() string {
	base := os.Getenv("XDG_CACHE_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".cache")
	}
	return filepath.Join(base, "langwatch", "upgrade-snapshots")
}

// ResolveSnapshot takes an entry directory, or a cache key under CacheRoot.
func ResolveSnapshot(dirOrKey string) string {
	if _, err := os.Stat(dirOrKey); err == nil {
		abs, _ := filepath.Abs(dirOrKey)
		return abs
	}
	return filepath.Join(CacheRoot(), dirOrKey)
}

func entryComplete(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, entrySnapshot, snapshot.ManifestFile))
	return err == nil
}

// ProduceCommand parses `upgradelab produce` flags and writes one entry; cli.go dispatches to it.
func ProduceCommand(ctx context.Context, args []string, stdout io.Writer) (int, error) {
	var options ProduceOptions
	flags := cellFlags("produce", &options.Options)
	flags.StringVar(&options.Out, "out", "", "the entry directory (default: the cache entry for the key under "+CacheRoot()+")")
	flags.BoolVar(&options.Force, "force", false, "produce again even when the entry exists")
	if err := flags.Parse(args); err != nil {
		return 2, err
	}
	var err error
	if options.Options, err = withDefaults(options.Options); err != nil {
		return 2, err
	}
	options.Shots, options.Stdout = false, stdout
	if options.PostgresBase == "" || options.ClickHouseBase == "" {
		if options.PostgresBase, options.ClickHouseBase, err = HavenServers(ctx); err != nil {
			return 2, err
		}
	}
	dir, err := Produce(ctx, options)
	if err != nil {
		return 2, err
	}
	fmt.Fprintf(stdout, "snapshot: %s\n", dir)
	return 0, nil
}

// Produce builds and boots main, seeds it, drives traffic, pauses its worker so jobs queue, and
// captures every store into the entry; an existing entry is reused unless Force.
func Produce(ctx context.Context, options ProduceOptions) (string, error) {
	dir := options.Out
	if dir == "" {
		dir = filepath.Join(CacheRoot(), CacheKey(options.Options))
	}
	if entryComplete(dir) && !options.Force {
		if options.Stdout != nil {
			fmt.Fprintf(options.Stdout, "upgradelab: %s is cached; -force produces it again\n", dir)
		}
		return dir, nil
	}
	if load := oneMinuteLoad(); options.MaxLoad > 0 && load > options.MaxLoad {
		return "", fmt.Errorf("machine load %.0f is above -max-load %.0f", load, options.MaxLoad)
	}
	light := options.Options
	if light.Tier == tierHeavy {
		light.Tier = "S" // prepare checks the light tiers; seedTier does the rest
	}
	cell, err := prepare(light)
	if err != nil {
		return "", err
	}
	cell.options.Tier, cell.report.Tier = options.Tier, options.Tier
	defer cell.teardown()
	build := func(ctx context.Context) error {
		return FromBuild(options.FromDir).Ensure(ctx, cell.logPath("from-build"))
	}
	cell.runSteps(ctx, []step{{"build", build}, {"stores", cell.freshStores}, {"from-schema", cell.fromSchema}, {"from-up", cell.fromUp},
		{"seed", cell.seedTier}, {"traffic-before", cell.trafficBefore}, {"cut", cell.cut},
		{"capture", func(ctx context.Context) error { return cell.capture(ctx, dir) }}})
	cell.finishTraffic()
	writeErr := cell.write()
	if cell.report.Error != "" {
		return "", fmt.Errorf("%s (logs in %s)", cell.report.Error, cell.options.RunDir)
	}
	return dir, writeErr
}

// tierHeavy is tier M: seedgen's medium, through main's doors (seed.Heavy).
const tierHeavy = "M"

// seedTier seeds tier S as the cell does; tier M adds the heavy tenancy by SQL and then the product's
// own doors at volume, against this cell's URL.
func (cell *run) seedTier(ctx context.Context) error {
	if cell.options.Tier != tierHeavy {
		return cell.seed(ctx)
	}
	cell.anchor = time.Now().UTC().Truncate(24 * time.Hour)
	shape := cell.profile.Shape
	tenancy := seed.BuildTenancy(seed.TenancyInput{Shape: shape, Seed: cell.options.Seed, Anchor: cell.anchor, Cloud: shape == "saas" || shape == "hybrid", Volume: tierHeavy})
	sum := sha256.Sum256([]byte(tenancy.SQL()))
	cell.tenancy, cell.recipe = tenancy, snapshot.Recipe{Version: seed.RecipeVersion, Hash: hex.EncodeToString(sum[:])}
	if err := psqlFile(ctx, cell.stores.psqlURL(), tenancy.SQL()); err != nil {
		return fmt.Errorf("tenancy: %w", err)
	}
	if err := psqlFile(ctx, cell.stores.psqlURL(), generate.AccountSQL(cell.options.Seed)); err != nil {
		return fmt.Errorf("seed account: %w", err)
	}
	email, password := generate.SeedAccount(cell.options.Seed)
	cell.seeder = seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: password, Label: cell.options.Name()})
	if err := cell.seeder.Seed(ctx); err != nil {
		cell.report.Notes = append(cell.report.Notes, "product seeds: "+err.Error())
	}
	if err := cell.useSeed(cell.seeder.Session()); err != nil {
		return err
	}
	if err := cell.basePrompt(ctx); err != nil {
		cell.report.Notes = append(cell.report.Notes, "base prompt (prompt-update writes to it): "+err.Error())
	}
	result, err := seed.Heavy(ctx, seed.HeavyInput{App: cell.url(), Email: email, Password: password, Tenancy: tenancy, Seed: cell.options.Seed, Anchor: cell.anchor})
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("heavy seed sent %v, refused %v", result.Sent, result.Refused))
	if err != nil {
		cell.report.Notes = append(cell.report.Notes, "heavy seed: "+err.Error())
	}
	return nil
}

// capture stops main's app (its worker stays paused, so queued jobs stay queued) and writes the
// entry beside dir first, renaming it in once whole, so a cache entry is never half written.
func (cell *run) capture(ctx context.Context, dir string) error {
	cell.finishTraffic()
	cell.proc("from-app").Stop(20 * time.Second)
	stores, err := cell.snapshotStores()
	if err != nil {
		return err
	}
	shape, err := seed.LoadShapeEnv(cell.profile.Shape)
	if err != nil {
		return err
	}
	allow := append(cell.tenancy.APIKeys(), cell.seeder.Context.APIKey)
	for _, name := range shape.SecretNames {
		allow = append(allow, shape.Secrets[name])
	}
	partial := dir + ".partial"
	if err := os.RemoveAll(partial); err != nil {
		return err
	}
	meta := snapshot.Manifest{ID: CacheKey(cell.options), Recipe: cell.recipe, Release: cell.options.Release, Image: "source",
		Shape: snapshot.Shape{Name: cell.profile.Shape, Env: shape.Values, SecretNames: shape.SecretNames}, Overlays: []string{},
		Seed: cell.options.Seed, Anchor: cell.anchor, GeneratorCommit: HeadCommit(cell.options.HeadDir), PostgresSchema: "mydb"}
	if _, err := snapshot.Capture(ctx, snapshot.CaptureInput{Dir: filepath.Join(partial, entrySnapshot), Stores: stores, Meta: meta,
		Scrubber: snapshot.Scrubber{Allow: allow}}); err != nil {
		return err
	}
	data, err := json.MarshalIndent(seedContext{Tenancy: cell.tenancy, Product: cell.seeder.Context}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(partial, entrySeed), data, 0o600); err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return os.Rename(partial, dir)
}

// snapshotStores are the cell's stores as the snapshot package reads and writes them.
// shortcut: only the shared object bucket travels; add private buckets when a snapshot.Stores holds several.
func (cell *run) snapshotStores() (snapshot.Stores, error) {
	stores := snapshot.Stores{ClickHouse: map[string]snapshot.ClickHouse{}}
	var err error
	if stores.Postgres, err = snapshot.NewPostgresCLI(cell.stores.DatabaseURL()); err != nil {
		return stores, err
	}
	if stores.Redis, err = snapshot.NewRedisRESP(cell.stores.RedisURL() + "/0"); err != nil {
		return stores, err
	}
	for _, label := range append([]string{""}, cell.stores.Private...) {
		target := "shared"
		if label != "" {
			target = "private-" + label
		}
		if stores.ClickHouse[target], err = snapshot.NewClickHouseHTTP(cell.stores.ClickHouseURL(label)); err != nil {
			return stores, err
		}
	}
	if _, ok := cell.stores.S3[""]; ok {
		account := cell.stores.ObjectAccount("")
		objects, err := snapshot.NewS3(account.Endpoint+"/"+account.Bucket+"?addressing=path",
			snapshot.Credentials{AccessKeyID: account.AccessKeyID, SecretAccessKey: account.SecretAccessKey})
		if err != nil {
			return stores, err
		}
		stores.Objects = objects
	}
	return stores, nil
}

// restore loads the entry into the fresh stores, writes their fingerprint before main boots (two
// cells from one snapshot must write the same file), and reads the producer's seed context.
func (cell *run) restore(ctx context.Context) error {
	dir := ResolveSnapshot(cell.options.FromSnapshot)
	stores, err := cell.snapshotStores()
	if err != nil {
		return err
	}
	if _, err := snapshot.Restore(ctx, snapshot.RestoreInput{Dir: filepath.Join(dir, entrySnapshot), Stores: stores}); err != nil {
		return err
	}
	fingerprint, err := snapshot.TakeFingerprint(ctx, stores)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(fingerprint, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(cell.options.RunDir, "restored-fingerprint.json"), data, 0o600); err != nil {
		return err
	}
	raw, err := os.ReadFile(filepath.Join(dir, entrySeed)) // #nosec G304 -- the producer's own file.
	if err != nil {
		return err
	}
	var saved seedContext
	if err := json.Unmarshal(raw, &saved); err != nil {
		return fmt.Errorf("%s: %w", entrySeed, err)
	}
	cell.tenancy, cell.seeder = saved.Tenancy, seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Label: cell.options.Name()})
	cell.seeder.Context = saved.Product
	return nil
}

// sessionCookie matches seed's: the better-auth session the sign-in sets.
var sessionCookie = regexp.MustCompile(`(?:__Secure-)?better-auth\.session_token=[^;]+`)

// resumeSeed signs the restored seed account in on main and points the clients at the restored project.
func (cell *run) resumeSeed(ctx context.Context) error {
	email, password := generate.SeedAccount(cell.options.Seed)
	cookie, err := signIn(ctx, cell.url(), email, password)
	if err != nil {
		return err
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return err
	}
	public, err := url.Parse(cell.url())
	if err != nil {
		return err
	}
	name, value, _ := strings.Cut(cookie, "=")
	jar.SetCookies(public, []*http.Cookie{{Name: name, Value: value}})
	product := cell.seeder.Context
	cell.seeder = seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: password, Label: cell.options.Name(),
		Client: &http.Client{Timeout: time.Minute, Jar: jar}})
	cell.seeder.Context = product
	return cell.useSeed(http.Header{"Origin": {cell.url()}, "Cookie": {cookie}})
}

func signIn(ctx context.Context, origin, email, password string) (string, error) {
	body, err := json.Marshal(map[string]string{"email": email, "password": password})
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/api/auth/sign-in/email", strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", origin)
	response, err := httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()
	for _, value := range response.Header.Values("Set-Cookie") {
		if cookie := sessionCookie.FindString(value); cookie != "" {
			return cookie, nil
		}
	}
	return "", fmt.Errorf("sign in as the restored seed account answered %d with no session cookie", response.StatusCode)
}
