package client

import "context"

// SlackConnectionsService lists the Slack connections a trigger can post
// through, so one can be named by id as "slackIntegrationId" in its
// ActionParams. Secrets are never returned.
//
// Access it via [Client.SlackConnections].
type SlackConnectionsService struct {
	client *Client
}

// SlackConnection is a Slack connection the project can deliver through.
type SlackConnection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Kind is "bot" (needs "slackChannelId" on the trigger) or "webhook".
	Kind string `json:"kind"`
	// ScopeType is "ORGANIZATION" or "PROJECT"; ScopeID and ScopeName name it.
	ScopeType string `json:"scopeType"`
	ScopeID   string `json:"scopeId"`
	ScopeName string `json:"scopeName"`
	// SlackTeamName is the Slack workspace a bot connection posts into.
	SlackTeamName *string `json:"slackTeamName"`
	CreatedAt     string  `json:"createdAt"`
}

// List returns the project's own Slack connections and its organization's.
//
//	connections, err := lw.SlackConnections.List(ctx)
func (s *SlackConnectionsService) List(ctx context.Context) ([]SlackConnection, error) {
	resp, err := s.client.gen.GetApiSlackConnections(ctx)
	var out []SlackConnection
	if derr := decodeInto("SlackConnections.List", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}
