# Noise sample licenses

These bundled noise samples are synthesised procedurally by
`javascript/scripts/generate-noise-samples.mjs` (deterministic — a seeded PRNG
drives every draw, so re-running reproduces byte-identical WAVs) and dedicated
to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Each is **3 seconds, 24 kHz mono PCM16**, layered into a distinct, continuously
audible ambience (the generator is the source of truth for how):

- cafe.wav — voice-band chatter murmur + slow conversation swell + sparse cup clinks
- street.wav — deep traffic rumble + tyre hiss + two passing-vehicle doppler sweeps
- office.wav — steady HVAC/mains hum (60/120/240 Hz) + faint air hiss + keystroke bursts
- airport.wav — large-hall crowd murmur + periodic band-limited PA announcement bursts
- babble.wav — six overlapping syllable-rate-modulated talkers, for the
  `multipleVoices` effect (NOT a `backgroundNoise` preset; see proposal §4.5
  L521 vs L533).

To regenerate: `node scripts/generate-noise-samples.mjs` (run from `javascript/`).

Replacing them with real-world recordings is possible: drop CC0-licensed WAV
files (24 kHz mono, PCM16) at the matching filenames. If you replace a sample
with copyrighted audio, add attribution and license details here.
