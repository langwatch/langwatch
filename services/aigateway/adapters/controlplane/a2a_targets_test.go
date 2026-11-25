package controlplane

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "targets are registered from the control plane"
func TestA2ATargetsLoadFromTheConfigWire(t *testing.T) {
	var w configWire
	require.NoError(t, json.Unmarshal([]byte(`{"a2a_targets":[
		{"name":"billing","agent_name":"Billing Agent","upstream_url":"https://billing.acme.test/a2a",
		 "upstream_headers":{"X-Billing-Token":"secret"},"allowed_virtual_key_ids":["vk_support"]},
		{"name":"open","upstream_url":"https://open.acme.test/a2a","allowed_virtual_key_ids":null}
	]}`), &w))

	targets := w.toDomain().A2ATargets

	require.Len(t, targets, 2)
	assert.Equal(t, "billing", targets[0].Name)
	assert.Equal(t, "https://billing.acme.test/a2a", targets[0].UpstreamURL)
	assert.Equal(t, "secret", targets[0].UpstreamHeaders["X-Billing-Token"])
	require.NotNil(t, targets[0].Policy)
	assert.Equal(t, []string{"vk_support"}, targets[0].Policy.AllowedVirtualKeyIDs)
	assert.Nil(t, targets[1].Policy)
}

// @scenario "a target the gateway cannot call safely is left out of the configuration"
// @scenario "a target URL that holds credentials is refused at save time"
func TestA2ATargetWithBadURLOrHeaderIsLeftOut(t *testing.T) {
	targets := buildA2ATargets([]a2aTargetWire{
		{Name: "ftp", UpstreamURL: "ftp://billing.acme.test"},
		{Name: "nohost", UpstreamURL: "https:///a2a"},
		{Name: "badcard", UpstreamURL: "https://a.acme.test", CardURL: "file:///etc/passwd"},
		{Name: "crlf", UpstreamURL: "https://a.acme.test", UpstreamHeaders: map[string]string{"X-Token": "a\r\nHost: evil"}},
		{Name: "userinfo", UpstreamURL: "https://agent:hunter2@a.acme.test"},
		{Name: "carduserinfo", UpstreamURL: "https://a.acme.test", CardURL: "https://agent:hunter2@a.acme.test/card.json"},
		{Name: "ok", UpstreamURL: "https://a.acme.test", CardURL: "https://a.acme.test/card.json"},
	})

	require.Len(t, targets, 1)
	assert.Equal(t, "ok", targets[0].Name)
}
