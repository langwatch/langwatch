package app

import (
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// LogCapper is implemented by a ClickHouse adapter whose server writes a log
// nothing else bounds. Optional, like LoadQuerier. CapLogs returns the bytes it
// emptied, 0 when the log was under its cap.
type LogCapper interface {
	CapLogs() (int64, error)
}

// capClickHouseLogs keeps a managed ClickHouse's unrotated log under its cap,
// recording each emptying like any other reclamation and warning on a failure.
func (o *Orchestrator) capClickHouseLogs() {
	c, ok := o.ch.(LogCapper)
	if !ok || !o.cfg.ShouldManageClickHouse {
		return
	}
	emptied, err := c.CapLogs()
	if err != nil {
		o.log.Warn("could not cap clickhouse stdout.log", zap.Error(err))
		return
	}
	if emptied == 0 {
		return
	}
	o.recordReap("clickhouse", "stdout.log", domain.HumanBytes(emptied)+" past its cap")
	o.log.Info("emptied oversized clickhouse stdout.log", zap.Int64("bytes", emptied))
}
