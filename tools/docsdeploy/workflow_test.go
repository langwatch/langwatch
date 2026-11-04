package docsdeploy_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// deployJob is docs-site.yml's deploy job, up to the next job.
func deployJob(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", ".github", "workflows", "docs-site.yml"))
	if err != nil {
		t.Fatal(err)
	}
	wf := string(raw)
	start := strings.Index(wf, "\n  deploy:\n")
	if start < 0 {
		t.Fatal("docs-site.yml has no deploy job")
	}
	end := strings.Index(wf[start+1:], "\n  docs-site-complete:\n")
	if end < 0 {
		t.Fatal("the deploy job is not followed by docs-site-complete")
	}

	return wf[start : start+1+end]
}

// steps returns each `- name:` step of the job with its body.
func steps(job string) map[string]string {
	out := map[string]string{}
	parts := strings.Split(job, "\n      - name: ")
	for _, part := range parts[1:] {
		name, body, _ := strings.Cut(part, "\n")
		out[name] = body
	}

	return out
}

// @scenario "Only main deploys, and only after the docs checks pass"
func TestDeployRunsOnlyOnMainAfterTheChecks(t *testing.T) {
	job := deployJob(t)
	for _, want := range []string{
		"needs: [changes, verify, build, check]",
		"github.ref == 'refs/heads/main'",
		"(github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
		"vars.DOCS_SITE_BUCKET != ''",
		"group: docs-deploy",
		"cancel-in-progress: false",
		"id-token: write",
	} {
		if !strings.Contains(job, want) {
			t.Errorf("the deploy job lacks %q", want)
		}
	}
}

// @scenario "A deploy caches each file by its name and keeps hashed files"
func TestDeployUploadsByNameInOrderAndNeverDeletesHashedFiles(t *testing.T) {
	job := deployJob(t)
	order := []string{
		"Upload the content-hashed files",
		"Upload the other static files",
		"Upload the Markdown exports",
		"Upload the text indexes",
		"Upload the pages and indexes",
		"Publish the redirects",
		"Invalidate the distribution",
	}
	last := -1
	for _, name := range order {
		at := strings.Index(job, "- name: "+name+"\n")
		if at < last {
			t.Errorf("step %q is missing or runs before the step listed above it", name)
		}
		last = at
	}
	s := steps(job)
	hashed := s["Upload the content-hashed files"]
	if strings.Contains(hashed, "--delete") || !strings.Contains(hashed, "immutable") {
		t.Errorf("the hashed upload must be immutable and never delete:\n%s", hashed)
	}
	if !strings.Contains(s["Check the deploy configuration"], "ROLE_ARN KVS_ARN") ||
		strings.Index(job, "Check the deploy configuration") > strings.Index(job, "Upload the content-hashed files") {
		t.Error("the deploy does not check its configuration before it uploads")
	}
	for _, name := range order[1:5] {
		body := s[name]
		if !strings.Contains(body, "--delete") {
			t.Errorf("%q does not delete what the build dropped", name)
		}
		if strings.Contains(body, "immutable") {
			t.Errorf("%q marks unhashed files immutable", name)
		}
		for _, hashed := range []string{"--exclude 'assets/*'", "--exclude '*.????????????.*'"} {
			if !strings.Contains(body, hashed) {
				t.Errorf("%q could delete a hashed file: it lacks %s", name, hashed)
			}
		}
	}
	if !strings.Contains(s["Upload the Markdown exports"], "--content-type 'text/markdown; charset=utf-8'") {
		t.Error("the exports are not uploaded as text/markdown")
	}
	if !strings.Contains(s["Upload the text indexes"], "--content-type 'text/plain; charset=utf-8'") {
		t.Error("llms.txt and the other text files are not uploaded as UTF-8")
	}
}
