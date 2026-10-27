package githubsim

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/cgi" //nolint:gosec // G504: runs git http-backend; Httpoxy only hit Go before 1.6.3
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// handleGit serves git smart-HTTP (/{owner}/{repo}.git/info/refs, git-upload-pack,
// git-receive-pack) through `git http-backend` over one bare repository per known
// repository, made on first use with a README commit on main. A token reads with
// contents:read and pushes with contents:write; a repository it cannot see is a 404.
func (s *Server) handleGit(w http.ResponseWriter, r *http.Request) {
	owner, name := r.PathValue("owner"), strings.TrimSuffix(r.PathValue("repo"), ".git")
	full := owner + "/" + name
	level := "read"
	if strings.HasSuffix(r.URL.Path, "/git-receive-pack") || r.URL.Query().Get("service") == "git-receive-pack" {
		level = "write"
	}
	if bearer(r) == "" {
		w.Header().Set("WWW-Authenticate", `Basic realm="GitHub"`)
		writeMessage(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	s.mu.Lock()
	tok := s.tokenAuth(w, r, "contents", level, full)
	repo := s.repos[strings.ToLower(full)]
	s.mu.Unlock()
	if tok == nil {
		return
	}
	if repo == nil {
		writeMessage(w, http.StatusNotFound, "Repository not found.")
		return
	}
	root, err := s.gitRoot()
	if err != nil {
		writeMessage(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.ensureBareRepo(root, repo.FullName); err != nil {
		writeMessage(w, http.StatusInternalServerError, err.Error())
		return
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		writeMessage(w, http.StatusInternalServerError, "githubsim needs git on PATH for clone and push")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/"+owner+"/"+r.PathValue("repo"))
	handler := &cgi.Handler{
		Path: gitPath, Args: []string{"http-backend"},
		Env: []string{
			"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=x-access-token",
			"PATH_INFO=/" + strings.ToLower(repo.FullName) + ".git" + rest,
		},
	}
	handler.ServeHTTP(w, r)
}

// gitRoot is the directory holding the bare repositories (GITHUBSIM_GIT_ROOT, else a temp dir per process).
func (s *Server) gitRoot() (string, error) {
	s.gitOnce.Do(func() {
		if s.cfg.GitRoot != "" {
			s.gitDir, s.gitErr = s.cfg.GitRoot, os.MkdirAll(s.cfg.GitRoot, 0o750)
			return
		}
		s.gitDir, s.gitErr = os.MkdirTemp("", "githubsim-git-")
	})
	return s.gitDir, s.gitErr
}

// ensureBareRepo makes <root>/<owner>/<repo>.git with one README commit on main when it is missing.
func (s *Server) ensureBareRepo(root, fullName string) error {
	s.gitMu.Lock()
	defer s.gitMu.Unlock()
	dir := filepath.Join(root, strings.ToLower(fullName)+".git")
	if _, err := os.Stat(filepath.Join(dir, "HEAD")); err == nil {
		return nil
	}
	steps := [][]string{
		{"init", "--bare", "--initial-branch=main", dir},
		{"-C", dir, "config", "http.receivepack", "true"},
	}
	for _, args := range steps {
		if _, err := runGit(args, ""); err != nil {
			return err
		}
	}
	blob, err := runGit([]string{"-C", dir, "hash-object", "-w", "--stdin"}, "# "+fullName+"\n\nA githubsim repository.\n")
	if err != nil {
		return err
	}
	tree, err := runGit([]string{"-C", dir, "mktree"}, "100644 blob "+blob+"\tREADME.md\n")
	if err != nil {
		return err
	}
	commit, err := runGit([]string{"-C", dir, "commit-tree", tree, "-m", "Initial commit"}, "")
	if err != nil {
		return err
	}
	_, err = runGit([]string{"-C", dir, "update-ref", "refs/heads/main", commit}, "")
	return err
}

// headMissing is true when the repository has a bare clone here and it lacks refs/heads/<branch>.
func (s *Server) headMissing(fullName, branch string) bool {
	root, err := s.gitRoot()
	if err != nil {
		return false
	}
	dir := filepath.Join(root, strings.ToLower(fullName)+".git")
	if _, err := os.Stat(filepath.Join(dir, "HEAD")); err != nil {
		return false
	}
	_, err = runGit([]string{"-C", dir, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch}, "")
	return err != nil
}

func runGit(args []string, stdin string) (string, error) {
	cmd := exec.CommandContext(context.Background(), "git", args...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=githubsim", "GIT_AUTHOR_EMAIL=githubsim@example.com",
		"GIT_COMMITTER_NAME=githubsim", "GIT_COMMITTER_EMAIL=githubsim@example.com",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
	)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", args[len(args)-1], err, strings.TrimSpace(errOut.String()))
	}
	return strings.TrimSpace(out.String()), nil
}
