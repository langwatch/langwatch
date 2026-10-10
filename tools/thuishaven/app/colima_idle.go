package app

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// idleStoppable is the part of the container runtime that stops a VM haven
// itself started once nothing needs it.
type idleStoppable interface {
	StopIfIdle(ctx context.Context) (bool, error)
	StoppedByHaven() bool
}

// stopColimaIfIdle stops the VM when haven started it, no stack on the machine
// needs a container and no container runs on it. A VM the user started is never
// stopped (the runtime refuses without haven's start record).
func (o *Orchestrator) stopColimaIfIdle(ctx context.Context) {
	rt, ok := o.container.(idleStoppable)
	if !ok || o.container == nil {
		return
	}
	if len(o.store.Stacks()) > 0 && len(domain.ContainerNeeds(o.containerNeedInputs())) > 0 {
		return
	}
	stopped, err := rt.StopIfIdle(ctx)
	if err != nil {
		o.log.Warn("could not stop the idle colima VM", zap.Error(err))
		return
	}
	if stopped {
		o.log.Info("stopped idle colima VM haven started")
	}
}
