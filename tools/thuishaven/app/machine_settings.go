package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runtimeEmptyStoppable stops the VM whoever started it, once no container
// runs on it: the runtime-auto-stop setting's half of the container runtime.
type runtimeEmptyStoppable interface {
	RunningContainers(ctx context.Context) (int, error)
	StopWhenEmpty(ctx context.Context) (bool, error)
}

func (o *Orchestrator) machineSettings() domain.MachineSettings {
	if o.store == nil {
		return domain.MachineSettings{}
	}
	return o.store.ReadMachineSettings()
}

func (o *Orchestrator) isObservabilityOff() bool { return o.machineSettings().ObservabilityOff }

// MachineSettingsView lists every machine setting with its current value.
func (o *Orchestrator) MachineSettingsView() []domain.MachineSettingView {
	return o.machineSettings().View()
}

// SetMachineSetting saves one setting and applies it at once; an empty value
// restores the default. The daemon tick keeps applying it afterwards.
func (o *Orchestrator) SetMachineSetting(ctx context.Context, name, value string) (string, error) {
	if o.store == nil {
		return "", errors.New("no store is wired in")
	}
	next, err := o.machineSettings().With(name, value)
	if err != nil {
		return "", err
	}
	if err := o.store.WriteMachineSettings(next); err != nil {
		return "", fmt.Errorf("saving the machine settings: %w", err)
	}
	message := fmt.Sprintf("%s set to %s", name, settingValue(next, name))
	if name == domain.SettingVM {
		return message + o.applyVMSetting(ctx, next.VMOff), nil
	}
	if name != domain.SettingObservability {
		return message, nil
	}
	applied, err := o.applyObservabilitySetting(ctx, !next.ObservabilityOff)
	if err != nil {
		return "", fmt.Errorf("%s, but %w", message, err)
	}
	return message + "; " + applied, nil
}

func settingValue(s domain.MachineSettings, name string) string {
	for _, v := range s.View() {
		if v.Name == name {
			return v.Value
		}
	}
	return ""
}

// applyVMSetting says what vm off means for the running stacks, and stops a VM
// haven started once nothing runs on it.
func (o *Orchestrator) applyVMSetting(ctx context.Context, off bool) string {
	if !off {
		return "; stacks may use the VM again from their next up"
	}
	o.stopColimaIfIdle(ctx)
	return "; ClickHouse and observability run natively from each stack's next up, and a VM haven started stops once nothing runs on it"
}

// applyObservabilitySetting stops (off) or starts and routes (on) the stack.
// Running stacks keep their exporter settings until their next up; an OTLP
// exporter with no collector drops its batches and carries on.
func (o *Orchestrator) applyObservabilitySetting(ctx context.Context, on bool) (string, error) {
	if o.obs == nil {
		return "observability is not managed here", nil
	}
	if on {
		endpoints, err := o.obs.Ensure(ctx)
		if err != nil {
			return "", fmt.Errorf("could not start the observability stack: %w", err)
		}
		o.routeObservability()
		return "observability stack running — grafana " + endpoints.GrafanaURL(), nil
	}
	if !o.obs.IsRunning(ctx) {
		o.proxy.Remove(domain.ObservabilityService, "")
		return "observability stack was not running", nil
	}
	if err := o.obs.Stop(ctx); err != nil {
		return "", fmt.Errorf("could not stop the observability stack: %w", err)
	}
	o.proxy.Remove(domain.ObservabilityService, "")
	return "observability stack stopped; stacks drop their exporters at their next up", nil
}

// stopObservabilitySwitchedOff is the tick's half of observability off: a
// stack something else started is stopped again.
func (o *Orchestrator) stopObservabilitySwitchedOff(ctx context.Context) {
	o.proxy.Remove(domain.ObservabilityService, "")
	if !o.obs.IsRunning(ctx) {
		return
	}
	if err := o.obs.Stop(ctx); err != nil {
		o.log.Warn("could not stop the switched-off observability stack", zap.Error(err))
		return
	}
	o.recordReap("observability", domain.ObservabilityService, "switched off in machine settings")
	o.log.Info("stopped the observability stack (switched off in machine settings)")
}

// autoStopRuntime stops the VM, whoever started it, once it has run with no
// container on it for the grace period. Any container restarts the clock.
func (o *Orchestrator) autoStopRuntime(ctx context.Context, grace time.Duration) {
	rt, ok := o.container.(runtimeEmptyStoppable)
	if !ok || !o.container.IsRunning(ctx) {
		o.runtimeIdleSince = time.Time{}
		return
	}
	if n, err := rt.RunningContainers(ctx); err != nil || n > 0 {
		o.runtimeIdleSince = time.Time{}
		return
	}
	now := o.sys.Now()
	if o.runtimeIdleSince.IsZero() {
		o.runtimeIdleSince = now
		return
	}
	if now.Sub(o.runtimeIdleSince) < grace {
		return
	}
	o.runtimeIdleSince = time.Time{}
	stopped, err := rt.StopWhenEmpty(ctx)
	if err != nil {
		o.log.Warn("could not stop the idle colima VM", zap.Error(err))
		return
	}
	if stopped {
		o.recordReap("colima", o.container.Profile(), "no container for "+grace.String()+" with runtime-auto-stop on")
		o.log.Info("stopped idle colima VM (runtime-auto-stop)", zap.Duration("grace", grace))
	}
}
