package githubsim

import (
	"strconv"
	"strings"
)

// graphCall answers one GraphQL request as the token's installation: the repository lookup,
// the pull-requests-for-branch query and the createPullRequest mutation gh sends. The caller holds s.mu.
type graphCall struct {
	s          *Server
	tok        *token
	errors     []gqlError
	deliveries []deliverRequest
}

const botLogin = "langwatch[bot]"

func (g *graphCall) queryRoot() map[string]any {
	return map[string]any{
		"__typename": "Query",
		"viewer":     map[string]any{"__typename": "Bot", "login": botLogin, "id": "BOT_1", "databaseId": 1},
		"repository": gqlResolver(func(args map[string]any) any {
			owner, _ := args["owner"].(string)
			name, _ := args["name"].(string)
			return g.repository(owner + "/" + name)
		}),
		"rateLimit": map[string]any{"limit": 5000, "remaining": 5000, "cost": 1, "resetAt": g.s.stamp()},
	}
}

func (g *graphCall) mutationRoot() map[string]any {
	return map[string]any{
		"__typename":        "Mutation",
		"createPullRequest": gqlResolver(g.createPullRequest),
	}
}

// visibleRepo is the repository the token can see, else nil.
func (g *graphCall) visibleRepo(fullName string) *repository {
	in := g.s.installs[g.tok.Installation]
	if in == nil || !g.s.tokenSees(g.tok, in, fullName) {
		return nil
	}
	return g.s.repos[strings.ToLower(fullName)]
}

func (g *graphCall) repository(fullName string) any {
	repo := g.visibleRepo(fullName)
	if repo == nil {
		g.errors = append(g.errors, gqlError{
			Type: "NOT_FOUND", Path: []string{"repository"},
			Message: "Could not resolve to a Repository with the name '" + fullName + "'.",
		})
		return nil
	}
	return g.repoNode(repo)
}

func (g *graphCall) repoNode(repo *repository) map[string]any {
	owner, name, _ := strings.Cut(repo.FullName, "/")
	web := g.s.webBase() + "/" + repo.FullName
	visibility := "PUBLIC"
	if repo.Private {
		visibility = "PRIVATE"
	}
	return map[string]any{
		"__typename": "Repository", "id": repoNodeID(repo), "databaseId": repo.ID,
		"name": name, "nameWithOwner": repo.FullName, "url": web, "sshUrl": "git@github.sim:" + repo.FullName + ".git",
		"owner":       map[string]any{"__typename": "Organization", "login": owner, "id": "O_" + owner},
		"description": "", "homepageUrl": "", "isPrivate": repo.Private, "visibility": visibility,
		"isFork": false, "isArchived": false, "isEmpty": false, "isTemplate": false, "isMirror": false,
		"isInOrganization": true, "parent": nil, "templateRepository": nil,
		"defaultBranchRef": map[string]any{"name": "main"},
		"viewerPermission": "WRITE", "viewerCanAdminister": false,
		"hasIssuesEnabled": true, "hasWikiEnabled": false, "hasProjectsEnabled": false, "hasDiscussionsEnabled": false,
		"mergeCommitAllowed": true, "rebaseMergeAllowed": true, "squashMergeAllowed": true, "autoMergeAllowed": false,
		"deleteBranchOnMerge": false, "createdAt": g.s.stamp(), "pushedAt": g.s.stamp(), "updatedAt": g.s.stamp(),
		"stargazerCount": 0, "forkCount": 0, "watchers": map[string]any{"totalCount": 0},
		"pullRequestTemplates": []map[string]any{}, "issueTemplates": []map[string]any{},
		"repositoryTopics": map[string]any{"nodes": []map[string]any{}},
		"primaryLanguage":  nil, "languages": map[string]any{"nodes": []map[string]any{}},
		"licenseInfo": nil, "codeOfConduct": nil, "fundingLinks": []map[string]any{},
		"pullRequests": gqlResolver(func(args map[string]any) any { return g.pullConnection(repo, args) }),
		"pullRequest": gqlResolver(func(args map[string]any) any {
			n, _ := args["number"].(float64)
			if p := g.s.findPull(repo.FullName, int(n)); p != nil {
				return g.pullNode(repo, p)
			}
			return nil
		}),
	}
}

func repoNodeID(repo *repository) string { return "R_" + strconv.FormatInt(repo.ID, 10) }

func (g *graphCall) pullConnection(repo *repository, args map[string]any) map[string]any {
	head, _ := args["headRefName"].(string)
	base, _ := args["baseRefName"].(string)
	states := map[string]bool{}
	if list, ok := args["states"].([]any); ok {
		for _, v := range list {
			if str, ok := v.(string); ok {
				states[str] = true
			}
		}
	}
	nodes := []map[string]any{}
	for _, p := range g.s.pulls {
		if !strings.EqualFold(p.Repo, repo.FullName) || (head != "" && p.HeadRef != head) || (base != "" && base != "main") {
			continue
		}
		if len(states) > 0 && !states[pullState(p)] {
			continue
		}
		nodes = append(nodes, g.pullNode(repo, p))
	}
	return map[string]any{
		"totalCount": len(nodes), "nodes": nodes,
		"edges":    edges(nodes),
		"pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil},
	}
}

func edges(nodes []map[string]any) []map[string]any {
	out := make([]map[string]any, len(nodes))
	for i, n := range nodes {
		out[i] = map[string]any{"node": n, "cursor": strconv.Itoa(i)}
	}
	return out
}

func pullState(p *pull) string {
	switch {
	case p.Merged:
		return "MERGED"
	case p.State == "closed":
		return "CLOSED"
	default:
		return "OPEN"
	}
}

func (g *graphCall) pullNode(repo *repository, p *pull) map[string]any {
	owner, name, _ := strings.Cut(p.HeadRepo, "/")
	return map[string]any{
		"__typename": "PullRequest", "id": "PR_" + strconv.FormatInt(repo.ID, 10) + "_" + strconv.Itoa(p.Number),
		"number": p.Number, "title": p.Title, "body": "", "url": g.s.webBase() + "/" + p.Repo + "/pull/" + strconv.Itoa(p.Number),
		"state": pullState(p), "isDraft": p.Draft, "closed": p.State == "closed", "merged": p.Merged,
		"headRefName": p.HeadRef, "baseRefName": "main", "isCrossRepository": !strings.EqualFold(p.HeadRepo, p.Repo),
		"headRepositoryOwner": map[string]any{"__typename": "Organization", "login": owner, "id": "O_" + owner},
		"headRepository":      map[string]any{"name": name, "nameWithOwner": p.HeadRepo},
		"author":              map[string]any{"__typename": "Bot", "login": p.User},
		"createdAt":           p.CreatedAt, "updatedAt": p.UpdatedAt, "closedAt": nilIfEmpty(p.ClosedAt), "mergedAt": nil,
		"maintainerCanModify": false, "mergeable": "MERGEABLE",
		"labels": map[string]any{"nodes": []map[string]any{}, "totalCount": 0},
	}
}

func nilIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// createPullRequest is gh's PullRequestCreate mutation: input {repositoryId, baseRefName, headRefName, title, body, draft}.
func (g *graphCall) createPullRequest(args map[string]any) any {
	input, _ := args["input"].(map[string]any)
	str := func(key string) string { v, _ := input[key].(string); return v }
	var repo *repository
	for _, candidate := range g.s.repos {
		if repoNodeID(candidate) == str("repositoryId") {
			repo = g.visibleRepo(candidate.FullName)
		}
	}
	fail := func(kind, message string) any {
		g.errors = append(g.errors, gqlError{Type: kind, Path: []string{"createPullRequest"}, Message: message})
		return nil
	}
	if repo == nil {
		return fail("NOT_FOUND", "Could not resolve to a node with the global id of '"+str("repositoryId")+"'")
	}
	if !grants(g.tok.Permissions, "pull_requests", "write") {
		return fail("FORBIDDEN", "Resource not accessible by integration")
	}
	head := str("headRefName")
	if _, branch, ok := strings.Cut(head, ":"); ok {
		head = branch
	}
	if str("title") == "" || head == "" {
		return fail("UNPROCESSABLE", "A title and a head branch are required")
	}
	for _, p := range g.s.pulls {
		if strings.EqualFold(p.Repo, repo.FullName) && p.HeadRef == head && p.State == "open" {
			return fail("UNPROCESSABLE", "A pull request already exists for "+g.s.ownerOf(repo.FullName)+":"+head+".")
		}
	}
	if g.s.headMissing(repo.FullName, head) {
		return fail("UNPROCESSABLE", "Head sha can't be blank, Base sha can't be blank, No commits between main and "+head+", Head ref must be a branch")
	}
	draft, _ := input["draft"].(bool)
	p := g.s.addPull(&pull{Repo: repo.FullName, Title: str("title"), HeadRef: head, Draft: draft, User: botLogin})
	if g.s.cfg.WebhookURL != "" {
		g.deliveries = append(g.deliveries, deliverRequest{Event: "pull_request", Action: "opened", Repo: p.Repo, Number: p.Number})
	}
	return map[string]any{"pullRequest": g.pullNode(repo, p), "clientMutationId": input["clientMutationId"]}
}
