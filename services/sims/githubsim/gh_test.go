package githubsim

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The three operations below are the exact text gh 2.100 sends (captured with GH_DEBUG=api
// against githubsim): `gh repo clone`, then `gh pr create`'s branch check and mutation.
const (
	ghRepositoryInfo = `fragment repo on Repository {
    id
    databaseId
    name
    owner { login }
    hasIssuesEnabled
    description
    hasWikiEnabled
    viewerPermission
    defaultBranchRef {
      name
    }
  }

  query RepositoryInfo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ...repo
      parent {
        ...repo
      }
      mergeCommitAllowed
      rebaseMergeAllowed
      squashMergeAllowed
    }
  }`
	ghPullRequestForBranch = `query PullRequestForBranch($owner: String!, $repo: String!, $headRefName: String!, $states: [PullRequestState!]) {
    repository(owner: $owner, name: $repo) {
      pullRequests(headRefName: $headRefName, states: $states, first: 30, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {url,id,number,state,baseRefName,headRefName,isCrossRepository,headRepositoryOwner{id,login,...on User{name}}}
      }
      defaultBranchRef { name }
    }
  }`
	ghPullRequestCreate = `mutation PullRequestCreate($input: CreatePullRequestInput!) {
      createPullRequest(input: $input) {
        pullRequest {
          id
          url
        }
      }
  }`
)

func graphql(t *testing.T, s *Server, tok, query string, vars map[string]any) map[string]any {
	t.Helper()
	body, err := json.Marshal(map[string]any{"query": query, "variables": vars})
	require.NoError(t, err)
	rec := call(s, "POST", "/api/graphql", tok, string(body))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

// @scenario "gh opens a pull request against githubsim over its enterprise-host API"
func TestGhRepositoryLookupBranchCheckAndCreate(t *testing.T) {
	s := testServer(t, func(c *Config) { c.GitRoot = t.TempDir() })
	tok := mint(t, s, "")

	info := graphql(t, s, tok, ghRepositoryInfo, map[string]any{"owner": "langwatch-demo", "name": "app"})
	repo := info["data"].(map[string]any)["repository"].(map[string]any)
	assert.Equal(t, "R_5001", repo["id"])
	assert.Equal(t, map[string]any{"login": "langwatch-demo"}, repo["owner"])
	assert.Equal(t, map[string]any{"name": "main"}, repo["defaultBranchRef"])
	assert.Nil(t, repo["parent"])
	assert.Equal(t, true, repo["squashMergeAllowed"])

	branch := graphql(t, s, tok, ghPullRequestForBranch, map[string]any{"owner": "langwatch-demo", "repo": "app", "headRefName": "feat/demo", "states": []string{"OPEN"}})
	nodes := branch["data"].(map[string]any)["repository"].(map[string]any)["pullRequests"].(map[string]any)["nodes"].([]any)
	require.Len(t, nodes, 1)
	assert.Equal(t, "OPEN", nodes[0].(map[string]any)["state"])

	created := graphql(t, s, tok, ghPullRequestCreate, map[string]any{"input": map[string]any{
		"repositoryId": "R_5001", "baseRefName": "main", "headRefName": "langy/fix", "title": "Fix it", "body": "b", "draft": false,
	}})
	pr := created["data"].(map[string]any)["createPullRequest"].(map[string]any)["pullRequest"].(map[string]any)
	assert.Equal(t, "https://github.sim/langwatch-demo/app/pull/2", pr["url"])
	assert.Equal(t, "Fix it", s.findPull("langwatch-demo/app", 2).Title)

	again := graphql(t, s, tok, ghPullRequestCreate, map[string]any{"input": map[string]any{
		"repositoryId": "R_5001", "baseRefName": "main", "headRefName": "langy/fix", "title": "Fix it",
	}})
	assert.Contains(t, again["errors"].([]any)[0].(map[string]any)["message"], "already exists")

	// The REST surface answers under /api/v3 as well.
	assert.Equal(t, http.StatusOK, call(s, "GET", "/api/v3/repos/langwatch-demo/app/pulls/2", tok, "").Code)
}

// @scenario "gh opens a pull request against githubsim over its enterprise-host API"
func TestGhRepositoryOutsideTheInstallationIsNotFound(t *testing.T) {
	s := testServer(t, nil)
	s.addRepo("someone-else/private", 0)
	tok := mint(t, s, "")
	out := graphql(t, s, tok, ghRepositoryInfo, map[string]any{"owner": "someone-else", "name": "private"})
	errs := out["errors"].([]any)
	require.Len(t, errs, 1)
	assert.Equal(t, "NOT_FOUND", errs[0].(map[string]any)["type"])
	assert.Contains(t, errs[0].(map[string]any)["message"], "Could not resolve to a Repository with the name 'someone-else/private'.")
	assert.Equal(t, http.StatusUnauthorized, call(s, "POST", "/api/graphql", "", `{"query":"{viewer{login}}"}`).Code)
}

// @scenario "git clones and pushes a seeded repository over smart HTTP"
func TestGitCloneAndPushOverSmartHTTP(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not on PATH")
	}
	s := testServer(t, func(c *Config) { c.GitRoot = t.TempDir() })
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	tok := mint(t, s, "")
	host := strings.TrimPrefix(srv.URL, "http://")
	work := t.TempDir()
	git := func(dir string, args ...string) (string, error) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0",
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
		out, err := cmd.CombinedOutput()
		return string(out), err
	}

	url := "http://x-access-token:" + tok + "@" + host + "/langwatch-demo/app.git"
	out, err := git(work, "clone", url, "app")
	require.NoError(t, err, out)
	assert.FileExists(t, filepath.Join(work, "app", "README.md"))

	dir := filepath.Join(work, "app")
	for _, args := range [][]string{{"checkout", "-b", "langy/x"}, {"commit", "--allow-empty", "-m", "change"}, {"push", "origin", "langy/x"}} {
		out, err := git(dir, args...)
		require.NoError(t, err, out)
	}
	assert.False(t, s.headMissing("langwatch-demo/app", "langy/x"), "the pushed branch is in the sim's repository")
	assert.True(t, s.headMissing("langwatch-demo/app", "langy/never-pushed"))

	out, err = git(work, "clone", "http://"+host+"/langwatch-demo/app.git", "anon")
	require.Error(t, err, "a clone without a token is asked for credentials and refused")
	assert.Contains(t, out, "could not read Username")

	s.mu.Lock()
	s.addRepo("someone-else/private", 0)
	s.mu.Unlock()
	out, err = git(work, "clone", "http://x-access-token:"+tok+"@"+host+"/someone-else/private.git", "other")
	require.Error(t, err)
	assert.Contains(t, strings.ToLower(out), "not found")
}
