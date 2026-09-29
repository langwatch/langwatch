package idpsim

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// SCIM requests for paginated reads, replacement, and deactivation.

// scimPageSize is what each list request asks for. A hundred is what Okta and
// Entra use, so a receiving side tuned for them is exercised the way they will
// exercise it.
const scimPageSize = 100

// maxSCIMPages stops a target whose paging is broken — one that ignores
// startIndex, say — from being read forever. At this page size that is a
// directory of half a million, which is far past anything worth simulating.
const maxSCIMPages = 5000

// fetchTargetUsers reads the full directory before planning changes.
func fetchTargetUsers(ctx context.Context, client *http.Client, at scimTarget) ([]targetUser, error) {
	resources, err := scimFetchList(ctx, client, scimGet{URL: at.URL + "/Users", Token: at.Token})
	if err != nil {
		return nil, err
	}
	return readTargetUsers(resources), nil
}

// readTargetUsers lifts one page of resources into the shape matching needs,
// skipping anything that is not an object: a target sending something else in
// its Resources array is describing nobody.
func readTargetUsers(resources []any) []targetUser {
	users := make([]targetUser, 0, len(resources))
	for _, raw := range resources {
		if resource, ok := raw.(map[string]any); ok {
			users = append(users, readTargetUser(resource))
		}
	}
	return users
}

// readTargetUser lifts the four fields matching needs out of one resource.
func readTargetUser(resource map[string]any) targetUser {
	user := targetUser{
		id:         stringField(resource, "id"),
		userName:   stringField(resource, "userName"),
		externalID: stringField(resource, "externalId"),
		// ABSENT MEANS ACTIVE. SCIM says `active` defaults to true, and a
		// target that omits it for its live users would otherwise read as a
		// directory where everybody has already been suspended — and the very
		// next sync would "reactivate" all of them.
		active: true,
	}
	if raw, ok := resource["active"].(bool); ok {
		user.active = raw
	}
	return user
}

func stringField(resource map[string]any, key string) string {
	if value, ok := resource[key].(string); ok {
		return value
	}
	return ""
}

// scimPageRequest is one page of one collection.
type scimPageRequest struct {
	URL        string
	Token      string
	StartIndex int
	Count      int
}

// scimFetchPage reads one page, returning its resources and the total the
// target claims to hold (zero when it does not say).
func scimFetchPage(
	ctx context.Context,
	client *http.Client,
	page scimPageRequest,
) ([]any, int, error) {
	address, err := url.Parse(page.URL)
	if err != nil {
		return nil, 0, err
	}
	query := address.Query()
	query.Set("startIndex", strconv.Itoa(page.StartIndex))
	query.Set("count", strconv.Itoa(page.Count))
	address.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address.String(), nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/scim+json")
	req.Header.Set("Authorization", "Bearer "+page.Token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, 0, fmt.Errorf("target answered %s", resp.Status)
	}
	var listed struct {
		Resources    []any `json:"Resources"`
		TotalResults int   `json:"totalResults"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listed); err != nil {
		return nil, 0, fmt.Errorf("unparseable list response: %w", err)
	}
	return listed.Resources, listed.TotalResults, nil
}

// scimPut is one whole-resource replacement.
type scimPut struct {
	URL      string
	Token    string
	Resource map[string]any
}

// scimReplace sends a PUT, which is how a provider states a changed record.
func scimReplace(ctx context.Context, client *http.Client, put scimPut) error {
	body, err := json.Marshal(withoutKey(put.Resource, "id"))
	if err != nil {
		return err
	}
	return scimSend(ctx, client, scimWrite{
		Method: http.MethodPut, URL: put.URL, Token: put.Token, Body: body,
	})
}

/**
 * scimDeactivate sends the PATCH that retires somebody.
 *
 * A PATCH rather than a PUT, because that is what Okta and Entra send for a
 * deactivation and because it says only the thing that changed — a receiving
 * side that treats a full PUT as "replace everything I know about them" would
 * lose whatever it had attached that the provider does not carry.
 */
func scimDeactivate(ctx context.Context, client *http.Client, at scimTarget) error {
	body, err := json.Marshal(map[string]any{
		"schemas": []string{"urn:ietf:params:scim:api:messages:2.0:PatchOp"},
		"Operations": []map[string]any{
			{"op": "replace", "path": "active", "value": false},
		},
	})
	if err != nil {
		return err
	}
	return scimSend(ctx, client, scimWrite{
		Method: http.MethodPatch, URL: at.URL, Token: at.Token, Body: body,
	})
}

// scimDelete removes a record outright.
func scimDelete(ctx context.Context, client *http.Client, at scimTarget) error {
	return scimSend(ctx, client, scimWrite{
		Method: http.MethodDelete, URL: at.URL, Token: at.Token,
	})
}

// scimTarget is one resource address and the credential for it.
type scimTarget struct {
	URL   string
	Token string
}

// scimWrite is one write the simulator sends to a service provider.
type scimWrite struct {
	Method string
	URL    string
	Token  string
	Body   []byte
}

// scimSend performs a write and reports only whether it was accepted: the
// response body of a PUT or a PATCH is the record we just sent.
func scimSend(ctx context.Context, client *http.Client, request scimWrite) error {
	var reader *bytes.Reader
	if request.Body != nil {
		reader = bytes.NewReader(request.Body)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, request.Method, request.URL, reader)
	if err != nil {
		return err
	}
	if request.Body != nil {
		req.Header.Set("Content-Type", "application/scim+json")
	}
	req.Header.Set("Accept", "application/scim+json")
	req.Header.Set("Authorization", "Bearer "+request.Token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("target answered %s", resp.Status)
	}
	return nil
}
