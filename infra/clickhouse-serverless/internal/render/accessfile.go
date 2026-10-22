package render

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// renderAccessUsers renders the users declared in CLICKHOUSE_ACCESS_FILE. An
// invalid file or an unreadable password directory stops the server starting.
func renderAccessUsers(log *zap.Logger, input *config.Input, usersD string) error {
	f, err := access.Load(input.AccessFile)
	if err != nil {
		return err
	}
	in, err := access.Gather(f)
	if err != nil {
		return fmt.Errorf("%s: %w", input.AccessFile, err)
	}
	p, _, err := access.Render(f, in, time.Now(), usersD)
	if err != nil {
		return err
	}
	for _, w := range p.Warnings {
		log.Warn(w)
	}
	log.Info("access users rendered", zap.Strings("users", p.UserNames()))
	return nil
}

// renderAccessAuth points token users' http_authentication at the sidecar.
func renderAccessAuth(input *config.Input, configD string) error {
	data, err := access.AuthServerYAML(input.AccessListen)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(configD, access.AuthFileName), data, 0o600)
}
