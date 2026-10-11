package app

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ensureClickHouseStackAccess gives the stack its own ClickHouse login and
// workload and points its CLICKHOUSE_URL at that login. Any failure keeps the
// shared admin login, so the stack comes up exactly as it did before.
func (o *Orchestrator) ensureClickHouseStackAccess(ctx context.Context, st *domain.Stack) {
	if o.cfg.Home == "" || st.Slug == "" {
		return
	}
	credentials, err := o.stackCredentials(st.Slug)
	if err != nil {
		o.log.Warn("clickhouse stack login skipped: no stored credentials", zap.String("slug", st.Slug), zap.Error(err))
		return
	}
	password := credentials[domain.ClickHouseStackPasswordKey]
	if password == "" {
		return
	}
	if err := o.ch.EnsureStackAccess(ctx, st.ClickHouseDatabase, password); err != nil {
		o.log.Warn("clickhouse stack login unavailable — keeping the shared login",
			zap.String("db", st.ClickHouseDatabase), zap.Error(err))
		return
	}
	st.ClickHouseUser = domain.ClickHouseStackUserFor(st.ClickHouseDatabase)
	st.ClickHousePassword = password
}

// clickHouseFocusTimeout bounds one focus re-weighting so the monitor tick
// never waits long on a busy server.
const clickHouseFocusTimeout = 5 * time.Second

// weightFocusedWorkload gives the stack the pressure governor treats as focused
// (the head of Stacks(), see demoteUnfocused) the larger ClickHouse share and
// every other provisioned stack the plain one. It writes only when the focus
// moved; a failed write is retried on the next tick.
func (o *Orchestrator) weightFocusedWorkload(ctx context.Context) {
	if o.ch == nil || !o.cfg.ShouldManageClickHouse {
		return
	}
	stacks := o.store.Stacks()
	if len(stacks) == 0 || stacks[0].Slug == o.clickHouseFocus {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, clickHouseFocusTimeout)
	defer cancel()
	for i, s := range stacks {
		if s.ClickHouseUser == "" || s.ClickHouseDatabase == "" {
			continue
		}
		weight := domain.StackWorkloadWeight
		if i == 0 {
			weight = domain.FocusedStackWorkloadWeight
		}
		if err := o.ch.SetStackWeight(ctx, s.ClickHouseDatabase, weight); err != nil {
			o.log.Warn("could not weight the clickhouse workload", zap.String("db", s.ClickHouseDatabase), zap.Error(err))
			return
		}
	}
	o.clickHouseFocus = stacks[0].Slug
}
