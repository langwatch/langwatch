# Docs video polish

Read the guide before you author a timeline:
<https://nexus.langwatch.ai/wiki/recording-video-for-docs>. It holds the
editorial rules, which target earns a zoom and how a take must be recorded.
This file is the format reference.

`polish-recording.mjs` turns a flat screen recording into a scene. It adds the
four things a Playwright recording cannot capture:

- **A background and a window.** The recording is drawn with rounded corners
  and a soft shadow over a background image, so the camera can move past the
  edge of the recording and still have something to show.
- **A camera.** It centres the click target and eases in on it before the
  click, holds while the result appears, and eases out again. The zoom is one
  number for both axes, so it never reads as a tilt.
- **A mouse cursor.** It travels to each target on a curved, eased path,
  becomes a pointing hand when it arrives, dips on the click, and carries a
  soft drop shadow.
- **A click ring.** A grey circle grows out of each click point and fades.

It can also apply the cut list, so one command goes from the raw take to the
finished file and the video is encoded once.

```bash
node docs/scripts/video/polish-recording.mjs \
  docs/scripts/video/timelines/agent-testing-overview.json
```

## Requirements

`ffmpeg`, `ffprobe` and `rsvg-convert`. Nothing from npm, so the script keeps
working after any dependency change.

```bash
brew install ffmpeg librsvg
```

## Options

| Option | What it does |
|---|---|
| `--out PATH` | write here instead of the timeline's `output` |
| `--background PATH` | override `frame.background`, to render a second variant |
| `--preview A:B` | render only seconds A to B, for a fast loop while you author beats |
| `--stills "1,4,8.5"` | write a PNG for each listed second of the result |
| `--stills-dir DIR` | where those PNGs go, default `stills/` next to the output |
| `--crf N` | override the encoder quality, lower is better |

Use `--preview` and `--stills` together while you tune. A 12 second preview
renders in about 15 seconds, and the stills are how you check that the cursor
lands on the correct element. `--stills` times are seconds of the file that was
written, so inside a preview they start at 0.

## Timeline format

Paths are relative to the timeline file, except `cursors/*` and
`backgrounds/*`, which resolve next to the script.

```jsonc
{
  "input": "../raw/take.webm",
  "output": "../../media/videos/name.webm",
  "fps": 30,
  "page":    { "width": 1440, "height": 900 },   // the recording viewport
  "size":    { "width": 1664, "height": 1040 },  // output, defaults to the source
  "quality": { "crf": 38, "cpuUsed": 2 },

  // Optional. Applies the cut list in the same pass, so there is one encode.
  "cut": { "speed": 2, "segments": [[17.2, 29.6], [31.6, 39.2]] },

  "frame": {
    "background": "backgrounds/light.webp",  // or backgrounds/dark.webp
    "fit": "native",                  // 1 output px per source px at 1x
    "radius": 13,                     // window corner radius
    "follow": 0.5,                    // how far the camera follows the target
    "shadow": { "blur": 44, "offsetX": 0, "offsetY": 20, "spread": 2, "opacity": 0.3 },
    "border": { "width": 1, "color": [255, 255, 255], "opacity": 0.45 }
  },

  "cursor": {
    "size": 128,                      // arrow height in output pixels
    "start": { "x": 308, "y": 264 },  // where it waits at t=0
    "travel": 0.9,                    // seconds to reach a target
    "settle": 0.14,                   // it arrives this long before the click
    "arc": 0.08,                      // how much the path bows, 0 is a straight line
    "fade": 0.3,
    "press":  { "scale": 0.84, "duration": 0.16 },
    "shadow": { "blur": 14, "offsetX": 1, "offsetY": 6, "opacity": 0.38 }
  },

  "click": {
    "radius": [12, 84],               // the ring grows between these
    "duration": 0.55,
    "fill": 0.05,                     // opacity of the disc inside the ring
    "stroke": 0.3,
    "strokeWidth": 2,
    "color": [86, 86, 86]
  },

  "zoom": {
    "default": 1.45,   // used by a beat that names no zoom
    "lead": 0.5,       // the zoom completes this long before the click
    "in": 0.62,        // ease in
    "out": 0.8,        // ease out
    "hold": 0.8        // default seconds to stay zoomed after the click
  },

  "beats": [ /* see below */ ]
}
```

### `size`, `fit` and quality

`size` is the output canvas. Make it larger than `page` so there is room for
the background around the window: 1664x1040 around a 1440x900 take gives a
comfortable margin. With `fit: "native"` the recording is drawn at its own
resolution at 1x, which is the sharpest it can be, and only a zoom resamples
it. A number instead of `"native"` scales the window to that fraction of the
output width.

Background images live in `backgrounds/` at their original resolution. Do not
downscale them: a zoom past 1x samples the background too.

### `follow`

At `1` the focus point sits dead centre of the frame, so a corner target puts a
lot of background on two sides. At `0` the window is pushed back until it
covers the frame and the camera never follows. `0.5` is the default and blends
the two. The same fraction applies to both axes, which is what stops a corner
zoom from drifting in one axis while it is pinned in the other.

### Beats

One beat per click, in output seconds. Coordinates are page pixels, the same
numbers a `boundingBox()` returns.

| Field | Meaning |
|---|---|
| `t` | the moment of the click, in seconds of the finished video |
| `tRaw` | the same moment in seconds of the raw take, mapped through `cut` |
| `x`, `y` | the click point, in page pixels |
| `zoom` | zoom factor for this beat, `1` for no zoom |
| `zoomAt` | zoom centre, when the click point is not what you want to frame |
| `hold` | seconds to stay zoomed after the click |
| `lead` | the zoom completes this long before the click |
| `in`, `out` | ease durations for this beat |
| `travel` | override the travel time into this beat |
| `click` | `false` moves the cursor without a click, and it stays an arrow |
| `cursor` | `false` zooms without moving the cursor |
| `hide` / `show` | fade the cursor out or back in at `t` |
| `note` | a comment for whoever reads the timeline next |

Two beats close together merge: when the second zoom starts before the first
has returned to 1x, the camera pans straight from one focus point to the other
instead of bouncing through 1x. That is how you follow a corner button to the
dialog it opens.

`zoomAt` is what you reach for when the click is on a button inside a dialog.
Centring on the button pushes the dialog against an edge; centring on the
dialog keeps it framed while the cursor still lands on the button.

## Choosing the zooms

The full rules are on the Nexus guide. In short:

- **Corners earn a zoom, centres usually do not.** A button in the top right is
  hard to find at full size. A dialog in the middle is already the only thing
  on screen.
- **Two zooms back to back are tiring.** When the next target is close in time,
  pan the camera to it at the same zoom instead of easing out and back in.
- **A close X never earns a zoom.** Nothing is being read there.
- **The zoom completes before the click.** `lead` is what does that. A zoom
  that arrives after the click shows the reader the result, not the action.
- Four or five zoom episodes in half a minute is already a lot.

## Authoring a timeline

**Coordinates.** Query the running app rather than reading them off a frame.
Drive the same locators the recording script used and print
`boundingBox()` centres.

**Times.** Have the recording script log every click, then give beats as
`tRaw` and let the `cut` block map them. For a take that did not log its
clicks, find the moment each click took effect and subtract about 0.15s:

```bash
ffmpeg -v error -i cut.webm -vf "select='gt(scene,0.0025)',metadata=print:file=-" \
  -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
```

## Recording so that the polish has something to work with

- **Log the clicks.** A recorder that writes `{t, x, y}` per click turns
  timeline authoring into a copy and paste.
- **Record at a device scale factor of 2 if you plan to zoom hard.** A
  1440x900 take zoomed to 1.5x is a 1.5x upscale, which the Catmull-Rom
  resampler holds together up to about 1.6x. A 2880x1800 take zoomed to the
  same 1.5x still has more pixels than the 1440x900 output, so the zoom costs
  nothing.
- **Leave a beat of stillness at each click.** The recorder in this repo holds
  280ms before every click, which is what gives the synthetic cursor room to
  arrive.

## Traps

- **Input seeking is not frame accurate on the raw take.** Playwright writes
  VP8 with sparse keyframes, so `-ss` before `-i` lands on the wrong frame.
  Cut with the `trim` filter. Output seeking on the finished VP9 is accurate,
  which is why `--stills` uses it.
- **A `setpts` at the end of a filter graph loses frames.** ffmpeg then guesses
  the frame rate from the timestamps, guesses the source rate, and drops to it.
  The graph this script builds always ends in `fps`, and the output always
  states `-r`.
- **Check the frames before you ship it.** Render with `--stills` and look at
  them. A beat whose time is 0.3s late puts the cursor on the wrong element,
  and the video still encodes without an error.

## Cursors

`cursors/arrow.svg` and `cursors/pointer.svg` are rasterised at run time, so
the cursor is sharp at any size. Point `cursor.arrow` and `cursor.pointer` at
other files to change them, and set `cursor.hotspot` when the new artwork puts
its tip somewhere else. The hotspot is a fraction of the artwork's own box:
`{ "x": 0.293, "y": 0.175 }` is the arrow's tip.
