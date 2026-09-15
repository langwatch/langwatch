package app

import (
	"context"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// JobRow is one agent job as `haven clean` considers it: the record's own facts
// plus the verdict on its scratch. Size is filled in separately (ScanJobSizes),
// the same split the worktree picker uses — the classification is instant and the
// `du` is not.
type JobRow struct {
	domain.JobRecord
	domain.JobVerdict
	// Age is how long ago the job was last touched, for the picker's age column.
	Age time.Duration
}

// PlanJobs classifies every agent job directory under the configured jobs root.
// It reads and decides only: nothing is removed here, and a root that does not
// exist yields no jobs rather than an error. The process table is sampled once
// for the whole plan — a per-job `ps` across two hundred directories would cost
// more than the reclaim saves — and the in-use guard is applied from that one
// snapshot before any verdict is reached.
func (o *Orchestrator) PlanJobs() ([]JobRow, error) {
	if o.jobs == nil || o.cfg.JobsRoot == "" {
		return nil, nil
	}
	records, err := o.jobs.Jobs(o.cfg.JobsRoot)
	if err != nil {
		return nil, err
	}
	now := o.sys.Now()
	commands := o.processCommands()
	rows := make([]JobRow, 0, len(records))
	for _, rec := range records {
		rec.InUse = o.jobInUse(rec, commands)
		rows = append(rows, JobRow{
			JobRecord:  rec,
			JobVerdict: domain.ClassifyJob(rec, now),
			Age:        domain.JobAge(rec, now),
		})
	}
	return rows, nil
}

// ScanJobSizes measures each row's disk usage on the same bounded concurrent
// queue the worktree sizes run on, feeding onSize as each lands. Only
// reclaimable jobs are sized: a job in use is never offered, so its size is a
// number nobody can act on and a `du` nobody asked for.
func (o *Orchestrator) ScanJobSizes(ctx context.Context, rows []JobRow, onSize func(index int, bytes int64)) {
	if onSize == nil || o.jobs == nil {
		return
	}
	o.scanPass(ctx, len(rows), sizeScanSlots(), func(i int) {
		if !rows[i].Reclaimable {
			return
		}
		if b, ok := o.jobs.Size(ctx, rows[i].Dir); ok {
			onSize(i, b)
		}
	})
}

// JobReclaimScope is how far a reclaim reaches into the terminal jobs. The
// default excludes a job that finished within domain.JobScratchRecent: its
// files are the ones somebody is still reading. IncludeRecentJobs is the single
// deliberate opt-in that reaches them, and no unattended path ever passes it.
type JobReclaimScope bool

const (
	// ColdJobsOnly reclaims only jobs classified cold — the default everywhere.
	ColdJobsOnly JobReclaimScope = false
	// IncludeRecentJobs also reclaims terminal jobs younger than
	// domain.JobScratchRecent. Only `haven clean --include-recent` passes it.
	IncludeRecentJobs JobReclaimScope = true
)

// ReclaimJobs deletes the scratch of the named job directories, keeping
// state.json and timeline.jsonl in each — what the job was and what it did
// survive its working files. It re-plans first and acts only on directories the
// current plan still calls reclaimable within scope. onDone is called once per
// input dir.
func (o *Orchestrator) ReclaimJobs(dirs []string, scope JobReclaimScope, onDone func(dir string, freed int64, err error)) {
	report := func(dir string, freed int64, err error) {
		if onDone != nil {
			onDone(dir, freed, err)
		}
	}
	allowed, err := o.reclaimableByDir(scope)
	if err != nil {
		for _, dir := range dirs {
			report(dir, 0, err)
		}
		return
	}
	for _, dir := range dirs {
		row, ok := allowed[dir]
		if !ok {
			report(dir, 0, errJobNotReclaimable(dir))
			continue
		}
		freed, rerr := o.reclaimOne(row)
		report(dir, freed, rerr)
	}
}

// reclaimableByDir re-plans and indexes what the plan currently offers within
// scope, so a stale selection — a job that started running again between the
// scan and the confirmation, or a recent one nobody asked for — is refused
// rather than acted on.
func (o *Orchestrator) reclaimableByDir(scope JobReclaimScope) (map[string]JobRow, error) {
	rows, err := o.PlanJobs()
	if err != nil {
		return nil, err
	}
	allowed := map[string]JobRow{}
	for i := range rows {
		if InScope(rows[i].JobVerdict, scope) {
			allowed[rows[i].Dir] = rows[i]
		}
	}
	return allowed, nil
}

// InScope reports whether a verdict may be acted on at this scope. It is the one
// place the cold rule is applied, so the picker, the unattended pass and the
// daemon cannot drift apart on what "reclaimable" means.
func InScope(v domain.JobVerdict, scope JobReclaimScope) bool {
	if !v.Reclaimable {
		return false
	}
	return v.Cold || scope == IncludeRecentJobs
}

// reclaimOne deletes one job's scratch and records the reclamation.
func (o *Orchestrator) reclaimOne(row JobRow) (int64, error) {
	freed, err := o.jobs.Reclaim(row.Dir, domain.JobRecordFiles)
	if err != nil {
		return freed, err
	}
	o.recordReap("jobscratch", row.ID, row.Reason)
	o.log.Info("reclaimed agent job scratch",
		zap.String("job", row.ID), zap.String("name", row.Name),
		zap.String("reason", row.Reason), zap.String("freed", domain.HumanBytes(freed)))
	return freed, nil
}

// errJobNotReclaimable names the one refusal ReclaimJobs makes: a directory the
// current plan does not offer. It is a refusal rather than a silent skip because
// a caller asking to reclaim a job that has come back to life needs to see that
// its request was not carried out.
func errJobNotReclaimable(dir string) error {
	return &jobNotReclaimableError{dir: dir}
}

type jobNotReclaimableError struct{ dir string }

func (e *jobNotReclaimableError) Error() string {
	return filepath.Base(e.dir) + " is not reclaimable right now (in use, still active, or finished too recently — pass --include-recent)"
}

// reapJobScratch is the daemon's unattended pass: it reclaims every job the plan
// calls cold — never one that finished in the last two days. Safe unattended in a way a database drop is not — the two
// record files are kept, and everything deleted is a finished (or week-cold)
// run's working files, regenerable by re-running the job (ADR-064).
func (o *Orchestrator) reapJobScratch() {
	rows, err := o.PlanJobs()
	if err != nil {
		o.log.Warn("job scratch reap: could not read the jobs root", zap.Error(err))
		return
	}
	var dirs []string
	for _, r := range rows {
		if InScope(r.JobVerdict, ColdJobsOnly) {
			dirs = append(dirs, r.Dir)
		}
	}
	if len(dirs) == 0 {
		return
	}
	o.ReclaimJobs(dirs, ColdJobsOnly, func(dir string, _ int64, rerr error) {
		if rerr != nil {
			o.log.Warn("job scratch reap failed", zap.String("job", filepath.Base(dir)), zap.Error(rerr))
		}
	})
}

// processCommands is one snapshot of every live process's command line, taken
// once per plan so the in-use guard costs a single process-table read however
// many job directories the machine has.
func (o *Orchestrator) processCommands() []string {
	samples := o.sys.ProcessSamples()
	cmds := make([]string, 0, len(samples))
	for _, p := range samples {
		cmds = append(cmds, p.Command)
	}
	return cmds
}

// jobInUse reports whether a live process is working in a job directory:
// haven's own launching job (named by HAVEN_JOB_DIR or CLAUDE_JOB_DIR), or any
// process whose command line mentions the job id or its directory. The
// process-table check is deliberately broad — a false "in use" costs one cycle's
// worth of disk, a false "free" deletes a running agent's working tree.
func (o *Orchestrator) jobInUse(rec domain.JobRecord, commands []string) bool {
	if rec.ID == "" {
		return false
	}
	for _, own := range o.cfg.OwnJobDirs {
		if own != "" && canonicalPath(own) == canonicalPath(rec.Dir) {
			return true
		}
	}
	for _, cmd := range commands {
		if strings.Contains(cmd, rec.ID) || strings.Contains(cmd, rec.Dir) {
			return true
		}
	}
	return false
}
