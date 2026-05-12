-- Cascade Langy data deletion when a Project is deleted.
-- See specs/assistant/memory-design.md §6: "Project deleted → Cascade-delete
-- all Langy data for that projectId." The Langy tables previously denormalized
-- projectId without a foreign key, leaving rows orphaned on project deletion.

ALTER TABLE "LangyConversation"
    ADD CONSTRAINT "LangyConversation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LangyMessage"
    ADD CONSTRAINT "LangyMessage_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LangyProjectMemory"
    ADD CONSTRAINT "LangyProjectMemory_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LangyProjectMemoryHistory"
    ADD CONSTRAINT "LangyProjectMemoryHistory_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LangyUserPreferences"
    ADD CONSTRAINT "LangyUserPreferences_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- LangyProjectMemory already has a unique index on projectId
-- (@@unique on the column creates one); drop the redundant standalone
-- index added in the original migration so the table has a single
-- canonical index on projectId.
DROP INDEX IF EXISTS "LangyProjectMemory_projectId_idx";
