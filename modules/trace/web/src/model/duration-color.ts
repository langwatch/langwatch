const thresholds = {
  span: {
    red: 30 * 1000,
    yellow: 10 * 1000,
  },
  first_token: {
    red: 30 * 1000,
    yellow: 10 * 1000,
  },
  total_time: {
    red: 30 * 1000,
    yellow: 10 * 1000,
  },
};

export const durationColor = (
  metric: keyof typeof thresholds,
  duration: number | null | undefined,
) => {
  if (duration == null || duration === undefined) {
    return "gray.500";
  }
  const threshold = thresholds[metric];
  if (duration > threshold.red) return "red";
  if (duration > threshold.yellow) return "yellow.600";
  return "green";
};
