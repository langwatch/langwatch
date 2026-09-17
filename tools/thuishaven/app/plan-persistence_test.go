package app

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/idpsim"
	"github.com/langwatch/langwatch/services/mailsim"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func simulatorDataDir(t *testing.T, children []Child, name, env string) string {
	t.Helper()
	child, found := findChild(children, name)
	require.True(t, found)
	for _, value := range child.Env {
		if dir, ok := strings.CutPrefix(value, env+"="); ok {
			return dir
		}
	}
	t.Fatalf("%s child has no %s", name, env)
	return ""
}

// @scenario "Force restarting a stack preserves mail and IdP data for its slug"
// @scenario "Different slugs keep separate mailboxes and IdP directories"
func TestSimulatorDataSurvivesForceRestartPerSlug(t *testing.T) {
	stack := restartStack()
	store := &fakeStore{stacks: []domain.Stack{stack}, slugCache: map[string]string{stack.WorktreeDir: stack.Slug}}
	sys := &fakeSystem{alive: map[int]bool{stack.LauncherPID: true}}
	o := restartOrch(store, sys)
	o.cfg.Home = t.TempDir()
	o.cfg.SimulatorArgv = []string{"/bin/haven", "simulator"}
	opts := PlanOptions{Selection: domain.DefaultSelection()}
	plan := o.planChildren(stack, opts, t.TempDir(), "")
	idpDir := simulatorDataDir(t, plan, "idp", "IDPSIM_DATA_DIR")
	mailDir := simulatorDataDir(t, plan, "mail", "MAILSIM_DATA_DIR")
	assert.Equal(t, filepath.Join(o.cfg.Home, "idp", stack.Slug), idpDir)
	assert.Equal(t, filepath.Join(o.cfg.Home, "mail", stack.Slug), mailDir)
	idp, err := idpsim.NewServer(idpsim.Config{DataDir: idpDir, Tenants: 1, BaseURL: "https://idp.example"})
	require.NoError(t, err)
	request := httptest.NewRequest("POST", "/control/t/1/users", strings.NewReader(`{"email":"kept@acme1.test"}`))
	response := httptest.NewRecorder()
	idp.Handler().ServeHTTP(response, request)
	require.Equal(t, http.StatusCreated, response.Code, response.Body.String())
	mail, err := mailsim.NewStore(mailDir)
	require.NoError(t, err)
	message := &mailsim.Message{Summary: mailsim.Summary{Subject: "Keep this email"}, Text: "verification link"}
	require.NoError(t, mail.Deliver(message))

	opts.ShouldForce = true
	proceed, err := o.reconcileRunningStack(UpParams{WorktreeDir: stack.WorktreeDir, IsLinkedWorktree: true}, opts)
	require.NoError(t, err)
	require.True(t, proceed)
	assert.Contains(t, sys.terminated, stack.LauncherPID)
	plan = o.planChildren(stack, opts, t.TempDir(), "")
	restartedIDP, err := idpsim.NewServer(idpsim.Config{
		DataDir: simulatorDataDir(t, plan, "idp", "IDPSIM_DATA_DIR"), Tenants: 1, BaseURL: "https://idp.example",
	})
	require.NoError(t, err)
	tenant, _ := restartedIDP.Tenant(1)
	_, found := tenant.FindUser("kept@acme1.test")
	assert.True(t, found)
	restartedMail, err := mailsim.NewStore(simulatorDataDir(t, plan, "mail", "MAILSIM_DATA_DIR"))
	require.NoError(t, err)
	got, found := restartedMail.Get(message.ID)
	require.True(t, found)
	assert.Equal(t, message, got)

	stack.Slug = "another-slug"
	otherPlan := o.planChildren(stack, opts, t.TempDir(), "")
	otherIDP, err := idpsim.NewServer(idpsim.Config{
		DataDir: simulatorDataDir(t, otherPlan, "idp", "IDPSIM_DATA_DIR"), Tenants: 1, BaseURL: "https://other.example",
	})
	require.NoError(t, err)
	otherTenant, _ := otherIDP.Tenant(1)
	_, found = otherTenant.FindUser("kept@acme1.test")
	assert.False(t, found)
	otherMail, err := mailsim.NewStore(simulatorDataDir(t, otherPlan, "mail", "MAILSIM_DATA_DIR"))
	require.NoError(t, err)
	assert.Empty(t, otherMail.List("", ""))
}
