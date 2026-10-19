package app

import (
	"context"
	"time"

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
// needs a container (none may with the vm setting off) and no container runs on
// it. A VM the user started is stopped only with runtime-auto-stop on, after
// its grace (autoStopRuntime).
func (o *Orchestrator) stopColimaIfIdle(ctx context.Context) {
	if o.container == nil {
		return
	}
	settings := o.machineSettings()
	if !settings.VMOff && len(o.store.Stacks()) > 0 && len(domain.ContainerNeeds(o.containerNeedInputs())) > 0 {
		o.runtimeIdleSince = time.Time{}
		return
	}
	if settings.RuntimeAutoStop {
		o.autoStopRuntime(ctx, settings.RuntimeIdleGrace())
		return
	}
	rt, ok := o.container.(idleStoppable)
	if !ok {
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
