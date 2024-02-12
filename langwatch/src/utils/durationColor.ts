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
  duration: number | null | undefined
) => {
  if (duration == null || duration === undefined) {
    return 'gray.500';
  }
  return duration > thresholds[metric].red
    ? 'red'
    : duration > thresholds[metric].yellow
    ? 'yellow.600'
    : 'green';
};
