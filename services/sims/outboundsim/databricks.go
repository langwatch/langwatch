package outboundsim

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ChannelDatabricks records the Databricks workspace calls governance pull sources make.
const ChannelDatabricks = "databricks"

// The workspace a token reads is named by a word in it, so each refusal a
// source can name has a credential that triggers it with no fault scripted.
const (
	dbxTenantSeeded    = "seeded"
	dbxTenantEmpty     = "empty"
	dbxTenantRevoked   = "revoked"
	dbxTenantNoScope   = "noscope"
	dbxTenantThrottled = "ratelimited"
	dbxTenantDown      = "down"
	dbxTenantMalformed = "malformed"
	dbxTenantCycle     = "cycle"
)

var dbxTenantWords = []string{
	dbxTenantEmpty, dbxTenantRevoked, dbxTenantNoScope, dbxTenantThrottled,
	dbxTenantDown, dbxTenantMalformed, dbxTenantCycle,
}

// dbxTenantOf is the workspace a credential reads: the first tenant word it holds, else the seed.
func dbxTenantOf(credential string) string {
	lower := strings.ToLower(credential)
	for _, word := range dbxTenantWords {
		if strings.Contains(lower, word) {
			return word
		}
	}
	return dbxTenantSeeded
}

type dbxSpace struct {
	ID    string `json:"space_id"`
	Title string `json:"title"`
}

type dbxUser struct {
	ID          string `json:"id"`
	UserName    string `json:"userName"`
	DisplayName string `json:"displayName,omitempty"`
	ExternalID  string `json:"externalId,omitempty"`
	Active      bool   `json:"active"`
}

// dbxWorkspace is the seeded Genie workspace. Timestamps hang off the moment it
// was made, so every read of one message reports the same instant.
type dbxWorkspace struct {
	mu     sync.Mutex
	origin time.Time
	spaces []dbxSpace
	users  []dbxUser
}

func seedDatabricks(now time.Time) *dbxWorkspace {
	return &dbxWorkspace{
		origin: now.Add(-3 * time.Hour).Truncate(time.Minute),
		spaces: []dbxSpace{
			{ID: "01simspacesales", Title: "Sales pipeline"},
			{ID: "01simspacefinance", Title: "Finance close"},
			{ID: "01simspacesupport", Title: "Support tickets"},
		},
		users: []dbxUser{
			{ID: "1001", UserName: "ada@sim.databricks.test", DisplayName: "Ada Analyst", Active: true},
			{ID: "1002", UserName: "ben@sim.databricks.test", DisplayName: "Ben Builder", Active: true},
			{ID: "1003", UserName: "cleo@sim.databricks.test", DisplayName: "Cleo Controller", Active: false},
		},
	}
}

func (d *dbxWorkspace) snapshot() ([]dbxSpace, []dbxUser) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]dbxSpace(nil), d.spaces...), append([]dbxUser(nil), d.users...)
}

// setUsers replaces the directory, so a tester can seed addresses that match the stack's members.
func (d *dbxWorkspace) setUsers(users []dbxUser) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.users = append([]dbxUser(nil), users...)
}

// conversations are two per space, each with one user's question and Genie's answer.
func (d *dbxWorkspace) conversations(spaceID string) []map[string]any {
	spaces, users := d.snapshot()
	out := []map[string]any{}
	for si, space := range spaces {
		if space.ID != spaceID {
			continue
		}
		for ci := range 2 {
			created := d.origin.Add(time.Duration(si*20+ci*5) * time.Minute)
			out = append(out, map[string]any{
				"conversation_id":   fmt.Sprintf("%s-conv%d", space.ID, ci+1),
				"title":             fmt.Sprintf("%s question %d", space.Title, ci+1),
				"created_timestamp": created.UnixMilli(),
				"user_id":           dbxUserNumber(users, si+ci),
			})
		}
	}
	return out
}

func (d *dbxWorkspace) messages(spaceID, conversationID string) []map[string]any {
	out := []map[string]any{}
	for _, conv := range d.conversations(spaceID) {
		if conv["conversation_id"] != conversationID {
			continue
		}
		created := conv["created_timestamp"].(int64)
		out = append(out, map[string]any{
			"message_id": conversationID + "-msg1", "conversation_id": conversationID, "space_id": spaceID,
			"user_id": conv["user_id"], "content": "What changed since last week?", "status": "COMPLETED",
			"created_timestamp": created + 1000,
			"attachments": []map[string]any{{
				"attachment_id": conversationID + "-att1",
				"query": map[string]any{
					"query": "SELECT region, sum(amount) FROM sim.sales GROUP BY region", "description": "Totals by region",
					"statement_id": conversationID + "-stmt1", "query_result_metadata": map[string]any{"row_count": 4},
				},
			}, {"attachment_id": conversationID + "-att2", "text": map[string]any{"content": "Four regions grew."}}},
		})
	}
	return out
}

func dbxUserNumber(users []dbxUser, i int) int64 {
	if len(users) == 0 {
		return 0
	}
	n, _ := strconv.ParseInt(users[i%len(users)].ID, 10, 64)
	return n
}

// dbxRefusal is the answer a refusing tenant gives, in Databricks' error shape; ok is false when it serves.
func dbxRefusal(tenant string) (reply, bool) {
	dbxError := func(status int, code, message string) reply {
		return jsonReply(status, map[string]string{"error_code": code, "message": message})
	}
	switch tenant {
	case dbxTenantRevoked:
		return dbxError(http.StatusUnauthorized, "UNAUTHENTICATED", "Invalid access token."), true
	case dbxTenantNoScope:
		return dbxError(http.StatusForbidden, "PERMISSION_DENIED", "The token lacks the required scope: genie, scim."), true
	case dbxTenantThrottled:
		r := dbxError(http.StatusTooManyRequests, "REQUEST_LIMIT_EXCEEDED", "Rate limit exceeded.")
		r.header = map[string]string{"Retry-After": "1"}
		return r, true
	case dbxTenantDown:
		return dbxError(http.StatusServiceUnavailable, "TEMPORARILY_UNAVAILABLE", "The workspace is unavailable."), true
	case dbxTenantMalformed:
		return reply{status: http.StatusOK, contentType: "text/html", body: "<html><body>Sign in to continue</body></html>"}, true
	}
	return reply{}, false
}

// bearerOf is the token after "Bearer ", or "" when there is none.
func bearerOf(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if len(value) > 7 && strings.EqualFold(value[:7], "bearer ") {
		return strings.TrimSpace(value[7:])
	}
	return ""
}

// dbxPage is items from page_token (an offset) for page_size, and the next token.
func dbxPage[T any](r *http.Request, items []T, tenant string) ([]T, any) {
	if items == nil {
		items = []T{}
	}
	size, err := strconv.Atoi(r.URL.Query().Get("page_size"))
	if err != nil || size < 1 {
		size = 100
	}
	start, _ := strconv.Atoi(r.URL.Query().Get("page_token"))
	start = min(max(start, 0), len(items))
	end := min(start+size, len(items))
	if tenant == dbxTenantCycle {
		return items[start:end], "0"
	}
	if end == len(items) {
		return items[start:end], nil
	}
	return items[start:end], strconv.Itoa(end)
}

// dbxServe answers a bearer-authenticated workspace read: the tenant's refusal, else serve's body.
func (s *Server) dbxServe(w http.ResponseWriter, r *http.Request, serve func(tenant string) reply) {
	c, ok := readCall(w, r, ChannelDatabricks, r.URL.Path)
	if !ok {
		return
	}
	token := bearerOf(r)
	if token == "" {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error_code": "UNAUTHENTICATED", "message": "No access token."}))
		return
	}
	tenant := dbxTenantOf(token)
	if refusal, refused := dbxRefusal(tenant); refused {
		s.finish(w, c, refusal)
		return
	}
	s.finish(w, c, serve(tenant))
}

func (s *Server) handleDbxToken(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelDatabricks, r.URL.Path)
	if !ok {
		return
	}
	clientID := basicUser(r.Header.Get("Authorization"))
	if clientID == "" {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "invalid_client"}))
		return
	}
	tenant := dbxTenantOf(clientID)
	if tenant == dbxTenantRevoked || tenant == dbxTenantNoScope {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "invalid_client"}))
		return
	}
	if tenant == dbxTenantMalformed {
		s.finish(w, c, reply{status: http.StatusOK, contentType: "text/html", body: "<html>Sign in</html>"})
		return
	}
	s.finish(w, c, jsonReply(http.StatusOK, map[string]any{
		"access_token": "dapi-oauth-" + clientID, "token_type": "Bearer", "expires_in": 3600, "scope": "all-apis",
	}))
}

// basicUser is the user half of an HTTP Basic header, or "".
func basicUser(header string) string {
	if len(header) < 6 || !strings.EqualFold(header[:6], "basic ") {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[6:]))
	if err != nil {
		return ""
	}
	user, _, _ := strings.Cut(string(decoded), ":")
	return user
}

func (s *Server) handleDbxSpaces(w http.ResponseWriter, r *http.Request) {
	s.dbxServe(w, r, func(tenant string) reply {
		spaces, _ := s.databricks.snapshot()
		if tenant == dbxTenantEmpty {
			spaces = nil
		}
		page, next := dbxPage(r, spaces, tenant)
		return jsonReply(http.StatusOK, map[string]any{"spaces": page, "next_page_token": next})
	})
}

func (s *Server) handleDbxConversations(w http.ResponseWriter, r *http.Request) {
	s.dbxServe(w, r, func(tenant string) reply {
		page, next := dbxPage(r, s.databricks.conversations(r.PathValue("space")), tenant)
		return jsonReply(http.StatusOK, map[string]any{"conversations": page, "next_page_token": next})
	})
}

func (s *Server) handleDbxMessages(w http.ResponseWriter, r *http.Request) {
	s.dbxServe(w, r, func(tenant string) reply {
		page, next := dbxPage(r, s.databricks.messages(r.PathValue("space"), r.PathValue("conversation")), tenant)
		return jsonReply(http.StatusOK, map[string]any{"messages": page, "next_page_token": next})
	})
}

// handleDbxUsers is the SCIM user list: 1-based startIndex and count, as Databricks pages it.
func (s *Server) handleDbxUsers(w http.ResponseWriter, r *http.Request) {
	s.dbxServe(w, r, func(tenant string) reply {
		_, users := s.databricks.snapshot()
		if tenant == dbxTenantEmpty {
			users = []dbxUser{}
		}
		start, err := strconv.Atoi(r.URL.Query().Get("startIndex"))
		if err != nil || start < 1 {
			start = 1
		}
		count, err := strconv.Atoi(r.URL.Query().Get("count"))
		if err != nil || count < 1 {
			count = 100
		}
		from := min(start-1, len(users))
		page := users[from:min(from+count, len(users))]
		return jsonReply(http.StatusOK, map[string]any{
			"schemas":   []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"},
			"Resources": page, "totalResults": len(users), "startIndex": start, "itemsPerPage": len(page),
		})
	})
}

func (s *Server) handleDbxUser(w http.ResponseWriter, r *http.Request) {
	s.dbxServe(w, r, func(string) reply {
		_, users := s.databricks.snapshot()
		for _, user := range users {
			if user.ID == r.PathValue("id") {
				return jsonReply(http.StatusOK, user)
			}
		}
		return jsonReply(http.StatusNotFound, map[string]any{"status": "404", "detail": "User not found."})
	})
}
