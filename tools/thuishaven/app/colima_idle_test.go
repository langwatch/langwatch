package app

import (
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type idleContainer struct {
	probedContainer
	stopCalls int
	stopped   bool
}

func (c *idleContainer) StopIfIdle(context.Context) (bool, error) {
	c.stopCalls++
	return true, nil
}
func (c *idleContainer) StoppedByHaven() bool { return c.stopped }

func idleOrch(c *idleContainer, stacks []domain.Stack) *Orchestrator {
	o := colimaOrch(c, stacks)
	o.log = zap.NewNop()
	return o
}

func TestIdleColimaIsStoppedWhenNoStackNeedsIt(t *testing.T) {
	c := &idleContainer{}
	o := idleOrch(c, []domain.Stack{{Slug: "a"}})
	o.stopColimaIfIdle(context.Background())
	if c.stopCalls != 1 {
		t.Errorf("StopIfIdle calls = %d, want 1", c.stopCalls)
	}
}

func TestColimaStaysWhenSandboxedLangyNeedsIt(t *testing.T) {
	c := &idleContainer{}
	o := idleOrch(c, []domain.Stack{{Slug: "b", LangyImage: "langy:abc"}})
	o.stopColimaIfIdle(context.Background())
	if c.stopCalls != 0 {
		t.Errorf("StopIfIdle calls = %d, want 0", c.stopCalls)
	}
}

func TestStatusSaysStoppedByHaven(t *testing.T) {
	c := &idleContainer{stopped: true}
	h := idleOrch(c, nil).colimaHealth(context.Background())
	if !h.OK || !strings.HasSuffix(h.Detail, "; stopped by haven") {
		t.Errorf("health = %+v", h)
	}
}
