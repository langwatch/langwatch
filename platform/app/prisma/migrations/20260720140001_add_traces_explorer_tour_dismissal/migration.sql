-- Persist automatic Traces Explorer tour dismissal on the user so it follows
-- them across projects, browsers, and devices.
-- IRREVERSIBLE: Dropping the column during rollback would discard user
-- preferences.
ALTER TABLE "User"
ADD COLUMN "tracesExplorerTourDismissedAt" TIMESTAMP(3);
