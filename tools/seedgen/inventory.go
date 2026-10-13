// Package seedgen is the deterministic seed generator. Design: dev/docs/plans/seed-2026-10-09.md.
package seedgen

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/readmegen"
)

// Inventory item ids, one prefix per category; runs compare by id, never by count.
const (
	CategoryEvent          = "event"     // event:<pipeline>/<event schema>
	CategoryProcessManager = "pm"        // pm:<pipeline>/<name>
	CategoryTable          = "table"     // table:<ClickHouse table or view>
	CategoryEnumValue      = "enum"      // enum:<Enum>.<VALUE>
	CategoryLifecycle      = "lifecycle" // lifecycle:<Model>.<column>
)

const (
	prismaSchema        = "packages/prisma-client/prisma/schema.prisma"
	clickhouseMigration = "packages/clickhouse-migrations/migrations"
)

// lifecycleColumns are the columns whose null and set states both need rows (plan §11.1).
var lifecycleColumns = map[string]bool{
	"archivedAt": true, "deletedAt": true, "revokedAt": true, "expiresAt": true,
	"disabledAt": true, "deactivatedAt": true, "erasedAt": true,
}

// clickhouseDDL is the clickhouse-table-ownership policy's replay of goose migrations.
var clickhouseDDL = regexp.MustCompile(`(?i)\b(CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE|VIEW)|DROP\s+(?:TABLE|VIEW))\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:\$\{[^}]*\}\.)?([A-Za-z_]\w*)`)
var sqlComment = regexp.MustCompile(`--[^\n]*`)

// Inventory is every item the seed must produce or exempt, as sorted ids.
func Inventory(root string, manifest readmegen.Manifest) ([]string, error) {
	items := processItems(manifest)
	prisma, err := prismaItems(filepath.Join(root, prismaSchema))
	if err != nil {
		return nil, err
	}
	tables, err := clickhouseItems(filepath.Join(root, clickhouseMigration))
	if err != nil {
		return nil, err
	}
	items = append(append(items, prisma...), tables...)
	sort.Strings(items)
	return items, nil
}

func processItems(manifest readmegen.Manifest) []string {
	var items []string
	for m := range manifest.Modules {
		pipelines := manifest.Modules[m].Process.Pipelines
		for p := range pipelines {
			name := pipelines[p].Name.String()
			for _, event := range pipelines[p].Events {
				items = append(items, CategoryEvent+":"+name+"/"+event)
			}
			for i := range pipelines[p].ProcessManagers {
				items = append(items, CategoryProcessManager+":"+name+"/"+pipelines[p].ProcessManagers[i].Name.String())
			}
		}
	}
	return items
}

// prismaItems reads enum values and lifecycle columns line by line; the schema is flat.
func prismaItems(file string) ([]string, error) {
	f, err := os.Open(file) // #nosec G304 -- a fixed path under the root the caller named
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var items []string
	var block, name string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		switch {
		case len(fields) == 0 || strings.HasPrefix(fields[0], "//") || strings.HasPrefix(fields[0], "@@"):
		case fields[0] == "}":
			block = ""
		case len(fields) >= 3 && (fields[0] == "enum" || fields[0] == "model") && fields[2] == "{":
			block, name = fields[0], fields[1]
		case block == "enum":
			items = append(items, CategoryEnumValue+":"+name+"."+fields[0])
		case block == "model" && lifecycleColumns[fields[0]]:
			items = append(items, CategoryLifecycle+":"+name+"."+fields[0])
		}
	}
	return items, scanner.Err()
}

// clickhouseItems replays every goose Up section in file order: what is created and not dropped.
func clickhouseItems(dir string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	live := map[string]bool{}
	for _, file := range files {
		data, err := os.ReadFile(file) // #nosec G304 -- migrations under the root the caller named
		if err != nil {
			return nil, err
		}
		up, _, _ := strings.Cut(string(data), "+goose Down")
		for _, match := range clickhouseDDL.FindAllStringSubmatch(sqlComment.ReplaceAllString(up, ""), -1) {
			live[match[2]] = strings.HasPrefix(strings.ToUpper(match[1]), "CREATE")
		}
	}
	var items []string
	for table, exists := range live {
		if exists {
			items = append(items, CategoryTable+":"+table)
		}
	}
	return items, nil
}
