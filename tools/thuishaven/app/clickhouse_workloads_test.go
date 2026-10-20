package app

import (
	"context"
	"errors"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func workloadOrchestrator(t *testing.T, store *fakeStore, ch *fakeDBServer) *Orchestrator {
	t.Helper()
	return &Orchestrator{
		cfg: Config{
			Home: t.TempDir(), Naming: domain.DefaultNaming(""),
			ShouldManageClickHouse: true, PortlessDisabled: true,
		},
		store: store, ch: ch, proxy: &fakeProxy{}, log: zap.NewNop(),
	}
}

func TestEnsureClickHouseGivesTheStackItsOwnLogin(t *testing.T) {
	ctx := context.Background()

	t.Run("given a reachable server", func(t *testing.T) {
		ch := &fakeDBServer{}
		o := workloadOrchestrator(t, &fakeStore{}, ch)
		st := domain.Stack{Slug: "feat-x"}

		t.Run("when the stack comes up, its URL names its own login and stored password", func(t *testing.T) {
			o.ensureClickHouse(ctx, &st)
			if st.ClickHouseUser != "lw_feat_x_app" || st.ClickHousePassword == "" {
				t.Fatalf("login = %q / set=%v, want the stack's own", st.ClickHouseUser, st.ClickHousePassword != "")
			}
			if ch.access["lw_feat_x"] != st.ClickHousePassword {
				t.Error("the server must be given the password the URL carries")
			}
		})

		t.Run("when it comes up again, the password is the same", func(t *testing.T) {
			again := domain.Stack{Slug: "feat-x"}
			o.ensureClickHouse(ctx, &again)
			if again.ClickHousePassword != st.ClickHousePassword {
				t.Error("a second up must not rotate the password under running lanes")
			}
		})
	})

	t.Run("given a server that refuses the login", func(t *testing.T) {
		ch := &fakeDBServer{accessErr: errors.New("ACCESS_DENIED")}
		o := workloadOrchestrator(t, &fakeStore{}, ch)
		st := domain.Stack{Slug: "feat-x"}

		t.Run("when the stack comes up, it keeps the shared admin login", func(t *testing.T) {
			o.ensureClickHouse(ctx, &st)
			if st.ClickHouseDatabase != "lw_feat_x" {
				t.Fatalf("database = %q, want the stack still provisioned", st.ClickHouseDatabase)
			}
			if user, _ := st.ClickHouseLogin(); user != domain.ClickHouseUser {
				t.Errorf("login = %q, want the shared admin", user)
			}
		})
	})
}

func TestWeightFocusedWorkload(t *testing.T) {
	ctx := context.Background()
	provisioned := func(slug, db string) domain.Stack {
		return domain.Stack{Slug: slug, ClickHouseDatabase: db, ClickHouseUser: db + "_app", ClickHousePassword: "pw"}
	}

	t.Run("given two provisioned stacks and one on the shared login", func(t *testing.T) {
		store := &fakeStore{focus: "feat-a", stacks: []domain.Stack{
			provisioned("feat-a", "lw_feat_a"),
			provisioned("feat-b", "lw_feat_b"),
			{Slug: "feat-c", ClickHouseDatabase: "lw_feat_c"},
		}}
		ch := &fakeDBServer{}
		o := workloadOrchestrator(t, store, ch)

		t.Run("when the focus is first seen, the head gets the focused weight and the rest the plain one", func(t *testing.T) {
			o.weightFocusedWorkload(ctx)
			if ch.weights["lw_feat_a"] != domain.FocusedStackWorkloadWeight || ch.weights["lw_feat_b"] != domain.StackWorkloadWeight {
				t.Errorf("weights = %v", ch.weights)
			}
			if _, ok := ch.weights["lw_feat_c"]; ok {
				t.Error("a stack with no login of its own has no workload to weight")
			}
		})

		t.Run("when the focus has not moved, nothing is written", func(t *testing.T) {
			ch.weights = nil
			o.weightFocusedWorkload(ctx)
			if ch.weights != nil {
				t.Errorf("weights = %v, want no writes", ch.weights)
			}
		})

		t.Run("when the focus moves, the weights swap", func(t *testing.T) {
			store.focus = "feat-b"
			o.weightFocusedWorkload(ctx)
			if ch.weights["lw_feat_b"] != domain.FocusedStackWorkloadWeight || ch.weights["lw_feat_a"] != domain.StackWorkloadWeight {
				t.Errorf("weights = %v", ch.weights)
			}
		})
	})

	t.Run("given heartbeats reorder the stacks", func(t *testing.T) {
		store := &fakeStore{focus: "feat-a", stacks: []domain.Stack{
			provisioned("feat-b", "lw_feat_b"), provisioned("feat-a", "lw_feat_a"),
		}}
		ch := &fakeDBServer{}
		o := workloadOrchestrator(t, store, ch)
		o.weightFocusedWorkload(ctx)

		t.Run("when the head changes but the focus does not, nothing is written", func(t *testing.T) {
			ch.weights = nil
			store.stacks[0], store.stacks[1] = store.stacks[1], store.stacks[0]
			o.weightFocusedWorkload(ctx)
			if ch.weights != nil {
				t.Errorf("weights = %v, want no writes", ch.weights)
			}
		})

		t.Run("when the focused stack goes, every stack gets the plain weight", func(t *testing.T) {
			store.RemoveStack("feat-a")
			store.stacks = append(store.stacks, provisioned("feat-c", "lw_feat_c"))
			o.weightFocusedWorkload(ctx)
			if ch.weights["lw_feat_b"] != domain.StackWorkloadWeight || ch.weights["lw_feat_c"] != domain.StackWorkloadWeight {
				t.Errorf("weights = %v", ch.weights)
			}
		})
	})

	t.Run("given a server that refuses the write", func(t *testing.T) {
		ch := &fakeDBServer{weightErr: errors.New("down")}
		o := workloadOrchestrator(t, &fakeStore{focus: "feat-a", stacks: []domain.Stack{provisioned("feat-a", "lw_feat_a")}}, ch)

		t.Run("when the tick fails, the next one tries again", func(t *testing.T) {
			o.weightFocusedWorkload(ctx)
			ch.weightErr = nil
			o.weightFocusedWorkload(ctx)
			if ch.weights["lw_feat_a"] != domain.FocusedStackWorkloadWeight {
				t.Errorf("weights = %v, want the retry to land", ch.weights)
			}
		})
	})
}
