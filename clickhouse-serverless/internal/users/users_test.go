package users

import (
	"strings"
	"testing"
)

func TestParseUsers_Valid(t *testing.T) {
	users, err := ParseUsers("appuser:s3cret:readwrite:mydb;analyst:pa$$:readonly:*")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}

	if users[0].Name != "appuser" || users[0].Role != "readwrite" || users[0].Password != "s3cret" {
		t.Errorf("user 0: got %+v", users[0])
	}
	if len(users[0].Databases) != 1 || users[0].Databases[0] != "mydb" {
		t.Errorf("user 0 databases: got %v", users[0].Databases)
	}
	if users[0].Hash == "" {
		t.Error("user 0 hash should not be empty")
	}

	if users[1].Name != "analyst" || users[1].Password != "pa$$" {
		t.Errorf("user 1: got %+v", users[1])
	}
}

func TestParseUsers_EmptySpec(t *testing.T) {
	users, err := ParseUsers("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users != nil {
		t.Errorf("expected nil, got %v", users)
	}
}

func TestParseUsers_InvalidUsername(t *testing.T) {
	_, err := ParseUsers("bad-name:pass:readonly:*")
	if err == nil || !strings.Contains(err.Error(), "invalid username") {
		t.Errorf("expected invalid username error, got: %v", err)
	}
}

func TestParseUsers_EmptyPassword(t *testing.T) {
	_, err := ParseUsers("user::readonly:*")
	if err == nil || !strings.Contains(err.Error(), "password is required") {
		t.Errorf("expected password required error, got: %v", err)
	}
}

func TestParseUsers_InvalidRole(t *testing.T) {
	_, err := ParseUsers("user:pass:superadmin:*")
	if err == nil || !strings.Contains(err.Error(), "invalid role") {
		t.Errorf("expected invalid role error, got: %v", err)
	}
}

func TestParseUsers_MissingFields(t *testing.T) {
	_, err := ParseUsers("user:pass:readonly")
	if err == nil || !strings.Contains(err.Error(), "expected username:password:role:databases") {
		t.Errorf("expected format error, got: %v", err)
	}
}

func TestParseUsers_HashDeterministic(t *testing.T) {
	u1, _ := ParseUsers("user:same:readonly:*")
	u2, _ := ParseUsers("user:same:readonly:*")
	if u1[0].Hash != u2[0].Hash {
		t.Error("same password should produce same hash")
	}
}

func TestRenderUser_ReadonlyGrants(t *testing.T) {
	user := User{Name: "reader", Role: "readonly", Databases: []string{"mydb"}, Hash: "abc"}
	data, err := RenderUser(user)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	yaml := string(data)
	if !strings.Contains(yaml, "GRANT SELECT ON `mydb`.* TO reader") {
		t.Errorf("missing SELECT grant in:\n%s", yaml)
	}
	if strings.Contains(yaml, "INSERT") {
		t.Errorf("readonly should not have INSERT in:\n%s", yaml)
	}
}

func TestRenderUser_ReadwriteGrants(t *testing.T) {
	user := User{Name: "writer", Role: "readwrite", Databases: []string{"analytics", "events"}, Hash: "abc"}
	data, err := RenderUser(user)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	yaml := string(data)
	for _, priv := range []string{"SELECT", "INSERT", "ALTER TABLE", "CREATE TABLE", "DROP TABLE"} {
		if !strings.Contains(yaml, "GRANT "+priv+" ON `analytics`.* TO writer") {
			t.Errorf("missing %s grant on analytics in:\n%s", priv, yaml)
		}
		if !strings.Contains(yaml, "GRANT "+priv+" ON `events`.* TO writer") {
			t.Errorf("missing %s grant on events in:\n%s", priv, yaml)
		}
	}
}

func TestRenderUser_AdminGrants(t *testing.T) {
	user := User{Name: "root", Role: "admin", Databases: []string{"*"}, Hash: "abc"}
	data, err := RenderUser(user)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(string(data), "GRANT ALL ON *.* TO root") {
		t.Errorf("missing ALL grant")
	}
}
