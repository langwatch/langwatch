package rules

// InFlight counts evaluations running now, globally and for one project.
type InFlight struct {
	Global  int
	Project int
}

// FairShareLimits caps evaluations in flight, globally and per project.
type FairShareLimits struct {
	Global     int
	PerProject int
}

// MayStart reports whether a project may start another evaluation: one
// project filling its own share never blocks another's (plan §5.5).
func MayStart(inFlight InFlight, limits FairShareLimits) bool {
	return inFlight.Global < limits.Global && inFlight.Project < limits.PerProject
}
