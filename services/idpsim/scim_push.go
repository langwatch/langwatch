package idpsim

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// scimPushRequest asks the simulator to act as the provisioning side of an
// IdP — the Okta/Entra role — and push one tenant's directory at a real SCIM
// service provider, such as the app's /Users and /Groups endpoints.
type scimPushRequest struct {
	// Target is the SCIM base URL (…/scim/v2 style — Users/Groups appended).
	Target string `json:"target"`
	// Token is the bearer token the target requires.
	Token string `json:"token"`
}

// scimPushResult reports what landed.
type scimPushResult struct {
	UsersCreated  int      `json:"usersCreated"`
	GroupsCreated int      `json:"groupsCreated"`
	Failures      []string `json:"failures,omitempty"`
}

// pushDirectory replays the tenant's users then groups against the target as
// SCIM 2.0 creates, mapping seeded member ids onto the ids the target minted.
func pushDirectory(ctx context.Context, t *Tenant, req scimPushRequest) scimPushResult {
	client := &http.Client{Timeout: 15 * time.Second}
	base := strings.TrimSuffix(req.Target, "/")
	var result scimPushResult

	targetIDs := map[string]string{} // simulator user id -> target-minted id
	for _, u := range t.Users() {
		created, err := scimCreate(ctx, client, scimPost{
			URL: base + "/Users", Token: req.Token, Resource: scimUserResource(u),
		})
		if err != nil {
			result.Failures = append(result.Failures, fmt.Sprintf("user %s: %v", u.UserName, err))
			continue
		}
		result.UsersCreated++
		if id, ok := created["id"].(string); ok {
			targetIDs[u.ID] = id
		}
	}
	for _, g := range t.Groups() {
		_, err := scimCreate(ctx, client, scimPost{
			URL: base + "/Groups", Token: req.Token,
			Resource: map[string]any{
				"schemas":     []string{scimGroupSchema},
				"displayName": g.Name,
				"members":     mappedMembers(g, targetIDs),
			},
		})
		if err != nil {
			result.Failures = append(result.Failures, fmt.Sprintf("group %s: %v", g.Name, err))
			continue
		}
		result.GroupsCreated++
	}
	return result
}

// mappedMembers translates a group's membership onto the ids the target minted
// when the users were pushed. A member the target never accepted is left out
// rather than sent as a dangling reference.
func mappedMembers(g *Group, targetIDs map[string]string) []map[string]any {
	members := []map[string]any{}
	for _, id := range g.MemberIDs {
		if mapped, ok := targetIDs[id]; ok {
			members = append(members, map[string]any{"value": mapped})
		}
	}
	return members
}

// scimPost is one create the simulator sends to an external SCIM service
// provider.
type scimPost struct {
	URL      string
	Token    string
	Resource map[string]any
}

func scimCreate(ctx context.Context, client *http.Client, post scimPost) (map[string]any, error) {
	// The target mints its own id; sending ours would be an SP-side identifier.
	body, err := json.Marshal(withoutKey(post.Resource, "id"))
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, post.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/scim+json")
	httpReq.Header.Set("Authorization", "Bearer "+post.Token)
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("target answered %s", resp.Status)
	}
	var created map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		return nil, fmt.Errorf("unparseable create response: %w", err)
	}
	return created, nil
}

func withoutKey(m map[string]any, key string) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if k != key {
			out[k] = v
		}
	}
	return out
}
