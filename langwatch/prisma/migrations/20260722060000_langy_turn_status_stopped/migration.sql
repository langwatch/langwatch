-- AlterEnum
-- ADR-058 gives a user-stopped turn its own terminal status, distinct from a
-- clean finish and from a failure. The projection already writes it; without
-- this value the write is refused by the enum constraint.
ALTER TYPE "LangyProjectionTurnStatus" ADD VALUE 'stopped';
