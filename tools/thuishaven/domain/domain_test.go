package domain

import "testing"

func TestDeriveSlugIsDeterministicPerWorktree(t *testing.T) {
	a := DeriveSlug("/work/trees/portless", nil)
	b := DeriveSlug("/work/trees/portless", nil)
	if a != b {
		t.Fatalf("same worktree must derive the same slug: %q vs %q", a, b)
	}
	if !ValidSlug(a) {
		t.Fatalf("derived slug %q is not well-formed", a)
	}
	if DeriveSlug("/work/trees/other", nil) == a {
		t.Fatalf("different worktrees should not collide by default")
	}
}

func TestDeriveSlugAppendsPlaceOnCollision(t *testing.T) {
	base := DeriveSlug("/work/trees/portless", nil)
	withCollision := DeriveSlug("/work/trees/portless", map[string]bool{base: true})
	if withCollision == base {
		t.Fatalf("collision should append a place word, got %q", withCollision)
	}
	if !ValidSlug(withCollision) {
		t.Fatalf("collision slug %q is not well-formed (want 2-3 words)", withCollision)
	}
}

func TestHostnameScheme(t *testing.T) {
	n := DefaultNaming("localhost")
	cases := map[string]string{
		n.Hostname("app", "happy-tiger"): "app.happy-tiger.langwatch.localhost",
		n.Hostname("api", "happy-tiger"): "api.happy-tiger.langwatch.localhost",
		n.Hostname("langwatch", ""):      "langwatch.localhost",
		n.Hostname("observability", ""):  "observability.langwatch.localhost",
		n.Hostname("telemetry", ""):      "telemetry.langwatch.localhost",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("hostname = %q, want %q", got, want)
		}
	}
}

func TestRouteNameStripsTLD(t *testing.T) {
	n := DefaultNaming("localhost")
	if got := n.RouteName("app", "happy-tiger"); got != "app.happy-tiger.langwatch" {
		t.Errorf("routeName = %q, want app.happy-tiger.langwatch", got)
	}
	if got := n.RouteName("langwatch", ""); got != "langwatch" {
		t.Errorf("routeName = %q, want langwatch", got)
	}
}

func TestURLOmitsDefaultPortAddsCustom(t *testing.T) {
	n := DefaultNaming("localhost")
	if got := n.URL("app", "happy-tiger", "https", 443); got != "https://app.happy-tiger.langwatch.localhost" {
		t.Errorf("default 443 URL = %q", got)
	}
	if got := n.URL("app", "happy-tiger", "https", 8443); got != "https://app.happy-tiger.langwatch.localhost:8443" {
		t.Errorf("custom-port URL = %q", got)
	}
}

func TestRedisDBInRange(t *testing.T) {
	for _, slug := range []string{"happy-tiger", "brave-otter", "zesty-yak-cove"} {
		if db := RedisDBForSlug(slug); db < 0 || db > 15 {
			t.Errorf("redis db for %q = %d, out of 0-15", slug, db)
		}
	}
}
