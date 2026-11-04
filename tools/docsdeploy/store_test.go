package docsdeploy_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/docsdeploy"
)

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestCLIReadsEveryPageAndUpdatesAgainstTheETag(t *testing.T) {
	calls := [][]string{}
	run := func(_ context.Context, name string, args ...string) (string, error) {
		calls = append(calls, append([]string{name}, args...))
		switch {
		case args[1] == "list-keys" && !slices.Contains(args, "--next-token"):
			return `{"Items":[{"Key":"/a","Value":"/b"}],"NextToken":"t1"}`, nil
		case args[1] == "list-keys":
			return `{"Items":[{"Key":"/c","Value":"/d"}]}`, nil
		case args[1] == "update-keys":
			return `{"ETag":"e2"}`, nil
		}
		return `{"ETag":"e1"}`, nil
	}
	cli := docsdeploy.CLI{ARN: "arn:kvs", Run: run}
	items, err := cli.List(context.Background())
	if err != nil || len(items) != 2 {
		t.Fatalf("List = %v, %v; want both pages", items, err)
	}
	etag, err := cli.Update(context.Background(), "e1", docsdeploy.Change{
		Puts:    []docsdeploy.Item{{Key: "/x", Value: "/y"}},
		Deletes: []string{"/a"},
	})
	if err != nil || etag != "e2" {
		t.Fatalf("Update = %q, %v", etag, err)
	}
	update := strings.Join(calls[len(calls)-1], " ")
	for _, want := range []string{
		"aws cloudfront-keyvaluestore update-keys --if-match e1",
		`--puts [{"Key":"/x","Value":"/y"}]`,
		`--deletes [{"Key":"/a"}]`,
		"--kvs-arn arn:kvs",
	} {
		if !strings.Contains(update, want) {
			t.Errorf("update command %q lacks %q", update, want)
		}
	}
}
