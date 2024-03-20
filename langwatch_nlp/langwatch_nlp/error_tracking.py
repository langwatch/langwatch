import sentry_sdk

sentry_sdk.init(
    dsn="https://2af6004124570442320f4613d3090df4@o4506053863079936.ingest.sentry.io/4506746161987584",
    # Set traces_sample_rate to 1.0 to capture 100%
    # of transactions for performance monitoring.
    traces_sample_rate=1.0,
    # Set profiles_sample_rate to 1.0 to profile 100%
    # of sampled transactions.
    # We recommend adjusting this value in production.
    profiles_sample_rate=1.0,
)
