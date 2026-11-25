package idpsim

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

type syncGroupWrite struct {
	base   string
	token  string
	tenant *Tenant
}

type targetGroup struct {
	id         string
	externalID string
	name       string
	members    []string
}

type targetUserIndex struct {
	byExternal map[string]targetUser
	byName     map[string]targetUser
}

// Group membership references the receiving provider's resource IDs (RFC7643§4.2).
func syncGroups(ctx context.Context, client *http.Client, w syncGroupWrite) writeTally {
	var tally writeTally
	at := scimTarget{URL: w.base, Token: w.token}
	users, err := fetchTargetUsers(ctx, client, at)
	if err != nil {
		tally.note("read", err, "group users")
		return tally
	}
	groups, err := fetchTargetGroups(ctx, client, at)
	if err != nil {
		tally.note("read", err, "groups")
		return tally
	}
	byExternal, byName := indexTargetUsers(users)
	indexedUsers := targetUserIndex{byExternal: byExternal, byName: byName}
	for _, group := range w.tenant.Groups() {
		members, err := targetGroupMembers(w.tenant, group.MemberIDs, indexedUsers)
		if err != nil {
			tally.note("resolve", err, group.Name)
			continue
		}
		existing, found := matchTargetGroup(group.ID, group.Name, groups)
		if found && existing.name == group.Name && slices.Equal(existing.members, members) {
			continue
		}
		op, err := w.writeGroup(ctx, client, targetGroup{
			id: existing.id, externalID: group.ID, name: group.Name, members: members,
		})
		tally.note(op, err, group.Name)
	}
	return tally
}

func (w syncGroupWrite) writeGroup(ctx context.Context, client *http.Client, group targetGroup) (string, error) {
	resource := groupResource(group.externalID, group.name, group.members)
	if group.id != "" {
		return "update", scimReplace(ctx, client, scimPut{
			URL: w.base + "/Groups/" + url.PathEscape(group.id), Token: w.token, Resource: resource,
		})
	}
	_, err := scimCreate(ctx, client, scimPost{URL: w.base + "/Groups", Token: w.token, Resource: resource})
	return "create", err
}

func indexTargetUsers(users []targetUser) (map[string]targetUser, map[string]targetUser) {
	byExternal, byName := map[string]targetUser{}, map[string]targetUser{}
	for _, user := range users {
		if user.externalID != "" {
			byExternal[user.externalID] = user
		}
		if user.userName != "" {
			byName[strings.ToLower(user.userName)] = user
		}
	}
	return byExternal, byName
}

func targetGroupMembers(tenant *Tenant, memberIDs []string, users targetUserIndex) ([]string, error) {
	members := make([]string, 0, len(memberIDs))
	for _, id := range memberIDs {
		user, ok := tenant.UserByID(id)
		if !ok {
			return nil, fmt.Errorf("directory member %s was not found", id)
		}
		if !user.Active {
			continue
		}
		target, ok := matchTarget(user, users.byExternal, users.byName)
		if !ok || target.id == "" {
			return nil, fmt.Errorf("member %s has no target resource", user.UserName)
		}
		members = append(members, target.id)
	}
	slices.Sort(members)
	return slices.Compact(members), nil
}

func matchTargetGroup(externalID, name string, groups []targetGroup) (targetGroup, bool) {
	for _, group := range groups {
		if group.externalID == externalID {
			return group, true
		}
	}
	for _, group := range groups {
		if group.name == name {
			return group, true
		}
	}
	return targetGroup{}, false
}

func groupResource(externalID, name string, members []string) map[string]any {
	values := make([]map[string]string, 0, len(members))
	for _, id := range members {
		values = append(values, map[string]string{"value": id})
	}
	return map[string]any{
		"schemas": []string{scimGroupSchema}, "externalId": externalID,
		"displayName": name, "members": values,
	}
}

func fetchTargetGroups(ctx context.Context, client *http.Client, at scimTarget) ([]targetGroup, error) {
	resources, err := scimFetchList(ctx, client, scimGet{URL: at.URL + "/Groups", Token: at.Token})
	if err != nil {
		return nil, err
	}
	groups := make([]targetGroup, 0, len(resources))
	for _, raw := range resources {
		group, err := parseTargetGroup(raw)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, nil
}

func parseTargetGroup(raw any) (targetGroup, error) {
	resource, ok := raw.(map[string]any)
	if !ok || stringField(resource, "id") == "" {
		return targetGroup{}, fmt.Errorf("target returned a group without an id")
	}
	group := targetGroup{id: stringField(resource, "id"), externalID: stringField(resource, "externalId"), name: stringField(resource, "displayName")}
	members, _ := resource["members"].([]any)
	for _, rawMember := range members {
		member, ok := rawMember.(map[string]any)
		if !ok || stringField(member, "value") == "" {
			return targetGroup{}, fmt.Errorf("target group %s has an invalid member", group.id)
		}
		group.members = append(group.members, stringField(member, "value"))
	}
	slices.Sort(group.members)
	group.members = slices.Compact(group.members)
	return group, nil
}
