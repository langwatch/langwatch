package clickhousedocker

import (
	"context"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// migrateLegacyData copies the old host bind-mount data into the named volume,
// once: only when the volume does not exist yet and the host dir has data. The
// host dir is left untouched (delete ~/.langwatch/portless/clickhouse/data by
// hand once the new server has proven itself).
func (s *Server) migrateLegacyData(ctx context.Context, dockerHost string) error {
	if s.rt.Docker(ctx, dockerHost, "volume", "inspect", domain.ClickHouseDataVolume).Run() == nil {
		return nil
	}
	if err := s.rt.Docker(ctx, dockerHost, "volume", "create", domain.ClickHouseDataVolume).Run(); err != nil {
		return fmt.Errorf("docker volume create %s: %w", domain.ClickHouseDataVolume, err)
	}
	if !s.hasLegacyData() {
		return nil
	}
	fmt.Printf("moving clickhouse data off the host bind mount into volume %s (one time) ...\n", domain.ClickHouseDataVolume)
	err := s.rt.Docker(ctx, dockerHost, "run", "--rm", "--entrypoint", "sh",
		"-v", s.dataDir()+":/from:ro", "-v", domain.ClickHouseDataVolume+":/to",
		s.image, "-c", "cp -a /from/. /to/").Run()
	if err != nil {
		_ = s.rt.Docker(ctx, dockerHost, "volume", "rm", "-f", domain.ClickHouseDataVolume).Run()
		return fmt.Errorf("copying legacy clickhouse data into the volume: %w", err)
	}
	return nil
}

func (s *Server) hasLegacyData() bool {
	entries, err := os.ReadDir(s.dataDir())
	return err == nil && len(entries) > 0
}
