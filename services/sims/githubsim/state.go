package githubsim

import (
	"strings"
	"time"
)

type account struct {
	Login string `json:"login"`
	ID    int64  `json:"id"`
	Type  string `json:"type"`
}

type repository struct {
	ID       int64  `json:"id"`
	FullName string `json:"full_name"`
	Private  bool   `json:"private"`
}

type installation struct {
	ID          int64             `json:"id"`
	Account     account           `json:"account"`
	Selection   string            `json:"repository_selection"`
	CreatedAt   string            `json:"created_at"`
	Suspended   bool              `json:"suspended"`
	Permissions map[string]string `json:"permissions"`
	Repos       []string          `json:"repositories"` // lower-cased full names
}

type pull struct {
	Repo      string `json:"repo"`
	Number    int    `json:"number"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Draft     bool   `json:"draft"`
	Merged    bool   `json:"merged"`
	User      string `json:"user"`
	HeadRef   string `json:"headRef"`
	HeadRepo  string `json:"headRepo"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	ClosedAt  string `json:"closedAt,omitempty"`
}

type checkRun struct {
	ID         int64  `json:"id"`
	Repo       string `json:"repo"`
	Name       string `json:"name"`
	HeadSHA    string `json:"head_sha"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion,omitempty"`
	StartedAt  string `json:"started_at"`
}

type token struct {
	Installation int64
	Expires      time.Time
	Permissions  map[string]string
	RepoIDs      []int64
	Login        string // set on an OAuth user token
}

type callRecord struct {
	At     string `json:"at"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
	Auth   string `json:"auth"`
	Fault  bool   `json:"fault"`
}

var defaultPermissions = map[string]string{
	"contents": "write", "pull_requests": "write", "metadata": "read", "checks": "write",
}

func (s *Server) seed() {
	org := account{Login: "langwatch-demo", ID: 7001, Type: "Organization"}
	s.addRepo("langwatch-demo/app", 5001)
	s.addRepo("langwatch-demo/docs", 5002)
	s.installs[1001] = &installation{
		ID: 1001, Account: org, Selection: "all", CreatedAt: s.stamp(),
		Permissions: copyMap(defaultPermissions), Repos: []string{"langwatch-demo/app", "langwatch-demo/docs"},
	}
	s.addPull(&pull{Repo: "langwatch-demo/app", Title: "feat: demo change", User: "octocat", HeadRef: "feat/demo"})
}

func (s *Server) addRepo(fullName string, id int64) *repository {
	key := strings.ToLower(fullName)
	if existing, ok := s.repos[key]; ok {
		return existing
	}
	if id == 0 {
		id = s.id()
	}
	repo := &repository{ID: id, FullName: fullName}
	s.repos[key] = repo
	return repo
}

// addPull numbers the pull request within its repository; the caller holds s.mu (or is single-threaded).
func (s *Server) addPull(p *pull) *pull {
	highest := 0
	for _, existing := range s.pulls {
		if strings.EqualFold(existing.Repo, p.Repo) && existing.Number > highest {
			highest = existing.Number
		}
	}
	p.Number = highest + 1
	if p.State == "" {
		p.State = "open"
	}
	if p.HeadRepo == "" {
		p.HeadRepo = p.Repo
	}
	p.CreatedAt, p.UpdatedAt = s.stamp(), s.stamp()
	s.pulls = append(s.pulls, p)
	return p
}

func (s *Server) findPull(repo string, number int) *pull {
	for _, p := range s.pulls {
		if strings.EqualFold(p.Repo, repo) && p.Number == number {
			return p
		}
	}
	return nil
}

// installationFor is the installation granting repo, or nil.
func (s *Server) installationFor(repo string) *installation {
	for _, in := range s.installs {
		for _, r := range in.Repos {
			if strings.EqualFold(r, repo) {
				return in
			}
		}
	}
	return nil
}

func (s *Server) ownerOf(repo string) string {
	owner, _, _ := strings.Cut(repo, "/")
	return owner
}

func copyMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (s *Server) record(rec callRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, rec)
	if over := len(s.calls) - s.cfg.MaxRecords; over > 0 {
		s.calls = append([]callRecord(nil), s.calls[over:]...)
	}
}
