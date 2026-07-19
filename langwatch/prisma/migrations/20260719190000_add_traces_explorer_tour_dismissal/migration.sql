-- Persist automatic Traces Explorer tour dismissal on the user so it follows
-- them across projects, browsers, and devices.
ALTER TABLE "User"
ADD COLUMN "tracesExplorerTourDismissedAt" TIMESTAMP(3);
