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

// ProvisioningTarget is the SCIM service provider the simulator provisions
// against — the app's /Users and /Groups endpoints, say — together with the
// bearer token that provider issued. It names one target for both directions:
// a push writes to it, a read-back asks it what it ended up holding.
type ProvisioningTarget struct {
	// BaseURL is the SCIM base URL (…/scim/v2 style — Users/Groups appended).
	BaseURL string `json:"target"`
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
// This is the simulator acting as the provisioning side of an IdP — the
// Okta/Entra role — against a real service provider such as the app's SCIM
// endpoints, presenting the token that provider issued.
func pushDirectory(ctx context.Context, t *Tenant, target ProvisioningTarget) scimPushResult {
	client := &http.Client{Timeout: 15 * time.Second}
	base := strings.TrimSuffix(target.BaseURL, "/")
	var result scimPushResult

	targetIDs := map[string]string{} // simulator user id -> target-minted id
	for _, u := range t.Users() {
		created, err := scimCreate(ctx, client, scimPost{
			URL: base + "/Users", Token: target.Token, Resource: scimUserResource(u),
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
			URL: base + "/Groups", Token: target.Token,
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

// directorySnapshot is what a target says it is holding, by the names a person
// would recognize rather than the ids it minted.
type directorySnapshot struct {
	Users  []string
	Groups []string
}

/**
 * Read the target's directory back.
 *
 * A push reports what the target accepted, which is not the same as what it
 * ended up with: a user who was already there, a group whose members were
 * dropped, a deactivation that landed as a delete. Reading back is how you see
 * the receiving side's own account of it, over the same credential, so a
 * provisioning run can be checked without leaving the simulator.
 */
func pullDirectory(ctx context.Context, target ProvisioningTarget) (directorySnapshot, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	base := strings.TrimSuffix(target.BaseURL, "/")
	var snapshot directorySnapshot

	users, err := scimFetchList(ctx, client, scimGet{URL: base + "/Users", Token: target.Token})
	if err != nil {
		return snapshot, err
	}
	snapshot.Users = resourceLabels(users, "userName", "displayName")
	groups, err := scimFetchList(ctx, client, scimGet{URL: base + "/Groups", Token: target.Token})
	if err != nil {
		return snapshot, err
	}
	snapshot.Groups = resourceLabels(groups, "displayName", "id")
	return snapshot, nil
}

// scimGet is one collection read the simulator asks an external SCIM service
// provider for.
type scimGet struct {
	URL   string
	Token string
}

// scimFetchList fetches one SCIM collection from a target and returns its
// Resources.
func scimFetchList(ctx context.Context, client *http.Client, get scimGet) ([]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, get.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/scim+json")
	req.Header.Set("Authorization", "Bearer "+get.Token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("target answered %s", resp.Status)
	}
	var listed struct {
		Resources []any `json:"Resources"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listed); err != nil {
		return nil, fmt.Errorf("unparseable list response: %w", err)
	}
	return listed.Resources, nil
}

// resourceLabels names each resource by the first attribute it actually
// carries, so a target that fills in fewer fields than we hoped still reads as
// a list of somebodies rather than a row of blanks.
func resourceLabels(resources []any, attrs ...string) []string {
	labels := make([]string, 0, len(resources))
	for _, raw := range resources {
		resource, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		label := "(unnamed)"
		for _, attr := range attrs {
			if value, ok := resource[attr].(string); ok && value != "" {
				label = value
				break
			}
		}
		labels = append(labels, label)
	}
	return labels
}

// pushSummary is the one sentence the page and the activity feed both show.
func pushSummary(result scimPushResult, base string) string {
	summary := fmt.Sprintf("pushed %s and %s into %s",
		countOf(result.UsersCreated, "user"), countOf(result.GroupsCreated, "group"), base)
	if len(result.Failures) > 0 {
		summary += fmt.Sprintf(", and %s refused", countOf(len(result.Failures), "resource"))
	}
	return summary
}

// pullSummary is the same, for a read-back.
func pullSummary(snapshot directorySnapshot, base string) string {
	return fmt.Sprintf("%s holds %s and %s", base,
		countOf(len(snapshot.Users), "user"), countOf(len(snapshot.Groups), "group"))
}

// countOf writes a count in words the feed can read back: "1 user", "3 users".
func countOf(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
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
