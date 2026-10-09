/** The acknowledgement describes the request, not a completed clustering run. */
export function manualTriggerFeedback(result: {
  started: boolean;
  reason?: "disabled" | "already_running";
}) {
  if (result.started) {
    return {
      title: "Topic clustering started",
      description: "This can take several minutes.",
      type: "success" as const,
    };
  }
  if (result.reason === "disabled") {
    return {
      title: "Topic clustering is temporarily disabled",
      description: "No new run was started. Please try again later.",
      type: "info" as const,
    };
  }
  return {
    title: "A run is already in progress",
    description: "Its results will appear here when it finishes.",
    type: "info" as const,
  };
}
