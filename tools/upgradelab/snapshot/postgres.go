package snapshot

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strings"
)

// Postgres is one database, dumped with pg_dump -Fc and restored with pg_restore.
type Postgres interface {
	Database() string
	Schema() string
	Dump(ctx context.Context, path string) error
	Restore(ctx context.Context, path string) error
	Render(ctx context.Context, path string, out io.Writer) error
	Exec(ctx context.Context, statement string) error
	Fingerprint(ctx context.Context) (map[string]TableFingerprint, error)
	Facts(ctx context.Context) (PostgresFacts, error)
	RelationCount(ctx context.Context) (int, error)
}

// PostgresFacts are the manifest fields read from Postgres.
type PostgresFacts struct {
	ServerVersion    string
	PrismaMigrations []string
}

// LedgerSchema is the upgrade ledger's schema beside an app schema.
func LedgerSchema(schema string) string { return schema + "_upgrade_ledger" }

// SchemaRenames moves a restored dump from schema `from` to `to`, its ledger schema with it
// (compose dumps from mydb, haven restores into public). A ledger absent in old releases is skipped.
func SchemaRenames(from, to string) []string {
	if from == to || from == "" {
		return nil
	}
	return []string{renameSchema(from, to), renameSchema(LedgerSchema(from), LedgerSchema(to))}
}

// renameSchema drops the empty destination a fresh database carries; a non-empty one fails the DROP.
func renameSchema(from, to string) string {
	return fmt.Sprintf(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = %s) THEN DROP SCHEMA IF EXISTS %s; ALTER SCHEMA %s RENAME TO %s; END IF; END $$`,
		quoteLiteral(from), quoteIdent(to), quoteIdent(from), quoteIdent(to))
}

func quoteIdent(name string) string   { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }
func quoteLiteral(text string) string { return `'` + strings.ReplaceAll(text, `'`, `''`) + `'` }

// PostgresCLI runs pg_dump, pg_restore and psql. The password travels in PGPASSWORD, never argv.
type PostgresCLI struct {
	url      string
	password string
	database string
	schema   string
}

// NewPostgresCLI reads a Prisma-style URL; its `schema` parameter (default public) is the app schema.
func NewPostgresCLI(raw string) (*PostgresCLI, error) {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		return nil, fmt.Errorf("postgres url must be postgresql://user@host/database")
	}
	query := parsed.Query()
	schema := query.Get("schema")
	if schema == "" {
		schema = "public"
	}
	query.Del("schema")
	parsed.RawQuery = query.Encode()
	password, _ := parsed.User.Password()
	parsed.User = url.User(parsed.User.Username())
	database := strings.TrimPrefix(parsed.Path, "/")
	if database == "" {
		return nil, fmt.Errorf("postgres url names no database")
	}
	return &PostgresCLI{url: parsed.String(), password: password, database: database, schema: schema}, nil
}

// Database is the database name from the URL.
func (postgres *PostgresCLI) Database() string { return postgres.database }

// Schema is the URL's schema parameter, public by default.
func (postgres *PostgresCLI) Schema() string { return postgres.schema }

func (postgres *PostgresCLI) run(ctx context.Context, out io.Writer, argv ...string) error {
	name := argv[0]
	command := exec.CommandContext(ctx, name, argv[1:]...)
	command.Env = append(os.Environ(), "PGPASSWORD="+postgres.password)
	var stderr bytes.Buffer
	command.Stdout, command.Stderr = out, &stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// Dump writes every schema with pg_dump in custom format.
func (postgres *PostgresCLI) Dump(ctx context.Context, path string) error {
	return postgres.run(ctx, io.Discard, "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--file", path, "--dbname", postgres.url)
}

// Restore loads a custom-format dump with pg_restore.
func (postgres *PostgresCLI) Restore(ctx context.Context, path string) error {
	return postgres.run(ctx, io.Discard, "pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", postgres.url, path)
}

// Render writes the dump's data as SQL text (COPY blocks) for the scrub; no server needed.
func (postgres *PostgresCLI) Render(ctx context.Context, path string, out io.Writer) error {
	return postgres.run(ctx, out, "pg_restore", "--data-only", "--file", "-", path)
}

// Exec runs one statement through psql.
func (postgres *PostgresCLI) Exec(ctx context.Context, statement string) error {
	_, err := postgres.query(ctx, statement)
	return err
}

func (postgres *PostgresCLI) query(ctx context.Context, statement string) ([][]string, error) {
	var out bytes.Buffer
	if err := postgres.run(ctx, &out, "psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "--dbname", postgres.url, "-c", statement); err != nil {
		return nil, err
	}
	var rows [][]string
	for line := range strings.SplitSeq(strings.TrimRight(out.String(), "\n"), "\n") {
		if line != "" {
			rows = append(rows, strings.Split(line, "\t"))
		}
	}
	return rows, nil
}

// fingerprintTables lists the app and ledger tables with their primary-key columns.
const fingerprintTables = `SELECT n.nspname, c.relname, coalesce((SELECT string_agg(quote_ident(a.attname), ',' ORDER BY k.ord)
  FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = c.oid AND i.indisprimary), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname IN (%s, %s) ORDER BY 1, 2`

// FingerprintSQL folds a table by its primary key, or the whole row when it has none.
func FingerprintSQL(schema, table, keyColumns string) string {
	key := "t"
	if keyColumns != "" {
		key = "row(" + keyColumns + ")"
	}
	return fmt.Sprintf(`SELECT count(*), coalesce(bit_xor(('x' || left(md5(%s::text), 16))::bit(64)::bigint), 0) FROM %s.%s AS t`,
		key, quoteIdent(schema), quoteIdent(table))
}

// Fingerprint keys app tables by name and ledger tables as upgrade_ledger.<name>, so a dump
// restored under another schema name fingerprints the same.
func (postgres *PostgresCLI) Fingerprint(ctx context.Context) (map[string]TableFingerprint, error) {
	tables, err := postgres.query(ctx, fmt.Sprintf(fingerprintTables, quoteLiteral(postgres.schema), quoteLiteral(LedgerSchema(postgres.schema))))
	if err != nil {
		return nil, err
	}
	fingerprint := map[string]TableFingerprint{}
	for _, table := range tables {
		rows, err := postgres.query(ctx, FingerprintSQL(table[0], table[1], table[2]))
		if err != nil {
			return nil, err
		}
		var count int64
		if _, err := fmt.Sscan(rows[0][0], &count); err != nil {
			return nil, err
		}
		hash, err := parseServerHash(rows[0][1])
		if err != nil {
			return nil, err
		}
		name := table[1]
		if table[0] != postgres.schema {
			name = "upgrade_ledger." + name
		}
		fingerprint[name] = TableFingerprint{Count: count, Hash: hash}
	}
	return fingerprint, nil
}

// Facts reads the server version and the finished Prisma migrations.
func (postgres *PostgresCLI) Facts(ctx context.Context) (PostgresFacts, error) {
	version, err := postgres.query(ctx, "SHOW server_version")
	if err != nil {
		return PostgresFacts{}, err
	}
	facts := PostgresFacts{ServerVersion: version[0][0], PrismaMigrations: []string{}}
	table := quoteIdent(postgres.schema) + "._prisma_migrations"
	present, err := postgres.query(ctx, fmt.Sprintf("SELECT to_regclass(%s) IS NOT NULL", quoteLiteral(table)))
	if err != nil || present[0][0] != "t" {
		return facts, err
	}
	names, err := postgres.query(ctx, "SELECT migration_name FROM "+table+" WHERE finished_at IS NOT NULL ORDER BY 1")
	for _, name := range names {
		facts.PrismaMigrations = append(facts.PrismaMigrations, name[0])
	}
	return facts, err
}

// RelationCount counts the relations outside the system schemas.
func (postgres *PostgresCLI) RelationCount(ctx context.Context) (int, error) {
	rows, err := postgres.query(ctx, `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`)
	if err != nil {
		return 0, err
	}
	var count int
	_, err = fmt.Sscan(rows[0][0], &count)
	return count, err
}
