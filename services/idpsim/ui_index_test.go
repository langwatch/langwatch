package idpsim

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// index renders the landing page the way a browser asks for it.
func index(t *testing.T, s *Server) string {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	return rec.Body.String()
}

// @scenario "The landing page says what to do before it lists the providers"
func TestIndexOrientsBeforeItLists(t *testing.T) {
	s := newTestServer(t, 3)

	t.Run("given someone opening the simulator for the first time", func(t *testing.T) {
		page := index(t, s)

		t.Run("when the page is read top to bottom", func(t *testing.T) {
			for _, step := range []string{"Pick a provider", "Register your application", "Sign in from LangWatch"} {
				assert.Contains(t, page, step, "the page should say what to do, in order")
			}
			// The instructions come before the grid: a list of twelve identical
			// cards tells a newcomer nothing about what to do with one.
			assert.Less(t, strings.Index(page, "Pick a provider"), strings.Index(page, `class="tenants"`),
				"the steps belong above the providers")
		})

		t.Run("when the reader needs the machine's own addresses", func(t *testing.T) {
			assert.Contains(t, page, testBase, "the base address is on the page")
			assert.Contains(t, page, `data-copy="`+testBase+`"`, "and it is copyable, because it gets pasted elsewhere")
		})

		t.Run("when the control API is offered", func(t *testing.T) {
			// It used to be one paragraph of eleven paths run together. Each one
			// now says what it does, and the whole thing is folded away.
			assert.Contains(t, page, "<details", "the API reference is collapsed by default")
			assert.Contains(t, page, "Puts one tenant back the way it started",
				"each endpoint says what it does rather than only its path")
		})
	})
}

// @scenario "A provider that already has an application registered is marked as such"
func TestIndexMarksTheProviderYouCameBackFor(t *testing.T) {
	s := newTestServer(t, 2)

	t.Run("given one tenant with a registered application", func(t *testing.T) {
		form := strings.NewReader("name=LangWatch&redirect_uris=" + testBase + "/cb")
		req := httptest.NewRequest(http.MethodPost, testBase+"/t/2/apps", form)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		require.Contains(t, []int{http.StatusOK, http.StatusSeeOther}, do(s, req).Code)

		t.Run("when the landing page lists the providers", func(t *testing.T) {
			page := index(t, s)
			assert.Contains(t, page, `class="pill on">1 registered`,
				"the tenant already set up is the one worth pointing at")
			assert.Equal(t, 1, strings.Count(page, `class="pill on"`),
				"and only that one — every other tenant is still untouched")
		})
	})
}
