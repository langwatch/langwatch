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
- **Pacing.** It freezes the source frame wherever the cursor would have to
  move faster than a viewer can follow, so a slow beat costs no re-cut.
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
| `--preview A:B` | render only seconds A to B **of the result**, for a fast loop while you author beats |
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
    "background": "backgrounds/default.webp",
    "fit": "native",                  // 1 output px per source px at 1x
    "radius": 13,                     // window corner radius
    "follow": 1,                      // how far the camera follows the target
    "shadow": { "blur": 44, "offsetX": 0, "offsetY": 20, "spread": 2, "opacity": 0.3 },
    "border": { "width": 1, "color": [255, 255, 255], "opacity": 0.45 }
  },

  "cursor": {
    "size": 128,                      // arrow height in output pixels
    "start": { "x": 308, "y": 264 },  // where it waits at t=0
    "speed": 850,                     // page px per second, sets the travel time
    // it arrives `settle` before a plain click, and `settle + pause.before`
    // before a click the timeline asked to hold on
    "minTravel": 0.45,
    "maxTravel": 1.5,
    "settle": 0.14,                   // it arrives this long before the click
    "arc": 0.08,                      // how much the path bows, 0 is a straight line
    "fade": 0.3,
    "press":  { "scale": 0.84, "duration": 0.16 },
    "shadow": { "blur": 14, "offsetX": 1, "offsetY": 6, "opacity": 0.38 }
  },

  // Freezes the source frame where a move would be too fast to follow.
  "pace": { "auto": true, "speed": 850, "dwell": 0.3, "afterDelay": 0.35 },

  "click": {
    "radius": [6, 42],                // the ring grows between these
    "duration": 0.55,
    "fill": 0.05,                     // opacity of the disc inside the ring
    "stroke": 0.3,
    "strokeWidth": 2,
    "color": [86, 86, 86]
  },

  "zoom": {
    "default": 1.9,    // used by a beat that names no zoom
    "lead": 0.5,       // the zoom completes this long before the click
    "in": 0.62,        // ease in, at `default`; a weaker zoom takes less
    "out": 0.8,        // ease out, same rule
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

`backgrounds/default.webp` is the one background in the repo, kept at its
original resolution. Do not downscale it, and do not downscale a replacement:
a zoom past 1x samples the background too. Try a candidate with
`--background <path>` before it goes anywhere near `backgrounds/`.

### `follow`

At `1`, the default, the focus point sits dead centre of the frame. A corner
target then puts a lot of background on two sides, which is the trade: the
camera path is a straight function of the zoom, so the motion has no kink
anywhere. At `0` the window stays centred and the camera never follows.
Anything between blends the two, and a blend bends the path a little, so lower
it only when a corner target shows more background than you want.

An earlier version clamped the window against the edge of the recording
instead. That clamp bent one axis and left the other straight, and the eye read
it as the page tilting and snapping back.

### Pacing

`pace` freezes the source frame so the camera and the cursor have time to
move. `auto` measures every leg of the cursor's path and inserts a freeze
wherever the move would be faster than `pace.speed` page pixels per second.
A beat asks for one of its own:

```jsonc
{ "t": 6.265, "x": 1361, "y": 137, "pause": { "before": 0.9, "after": 1.0 } }
```

`before` holds the frame before the click, so the camera arrives and the
viewer sees what is about to be pressed. The cursor arrives at the start of
that hold rather than the end of it, since a pause has to read as "about to
press this" and cannot while the cursor is somewhere else. `after` holds the
frame once the result is on screen, which is what buys a long camera pan its
time. `"pause": 0.9` is shorthand for `before` alone.

Do not reach for `pause` on a click that needs no explanation. Every hold you
add is a beat the viewer waits through, and a video that pauses before all of
them reads as lag rather than emphasis.

`skip` is the same machinery with the sign flipped. `"skip": 1.25` on a beat
drops the 1.25 seconds of source right before it, which is how dead air in the
take is removed without re-cutting. Confirm the take really is still over that
stretch first, or the drop becomes a jump cut:

```bash
ffmpeg -v error -i cut.webm -vf \
  "trim=6.8:10.2,setpts=PTS-STARTPTS,select='gte(scene,0)',metadata=print:file=-" \
  -f null -
```

A run of `lavfi.scene_score=0.000000` is a stretch nobody will miss.

Every beat after a freeze moves by that much, and the script prints each one
when it runs, so the timing is auditable:

```
pacing: 32.83s -> 34.46s  [5.96+0.08 6.26+0.90 6.61+1.00 8.63-1.25 ...]
```

Beat times in the timeline are always source seconds, so a pause or a skip
never means retiming the beats that follow.

### Beats

One beat per click, in seconds of the cut source. Pacing moves them onto the
output clock for you, so a `pause` on one beat never means retiming the rest.
Coordinates are page pixels, the same numbers a `boundingBox()` returns.

| Field | Meaning |
|---|---|
| `t` | the moment of the click, in seconds of the cut source |
| `tRaw` | the same moment in seconds of the raw take, mapped through `cut` |
| `x`, `y` | the click point, in page pixels |
| `zoom` | zoom factor for this beat, `1` for no zoom |
| `zoomAt` | zoom centre, when the click point is not what you want to frame |
| `hold` | seconds to stay zoomed after the click |
| `lead` | the zoom completes this long before the click |
| `in`, `out` | ease durations for this beat |
| `travel` | override the travel time into this beat |
| `arc` | how much the path into this beat bows, `0` for a ruled line |
| `pause` | `{ before, after }` seconds to freeze the source around the click |
| `skip` | seconds of source to drop immediately before this beat |
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

A run of `click: false` beats with `arc: 0` walks the cursor along a path
without pressing anything. The overview video uses that to read the pass
criteria back: left to right under the first one, down and back to the left
under the second, then out. Pacing gives each leg its time, so the viewer's eye
follows the cursor through the text.

## Choosing the zooms

The full rules are on the Nexus guide. In short:

- **Corners earn a zoom, centres usually do not.** A button in the top right is
  hard to find at full size. A dialog in the middle is already the only thing
  on screen.
- **If a move looks rushed, pause it, do not shorten the path.** `pace.auto`
  catches most of them. Add `pause` by hand where the viewer has to read
  something before the click, and nowhere else.
- **Every zoom in a video moves at one rate.** Do not hand-tune `in` and `out`
  per beat to fit a gap. If a zoom has no room, give it room with `pause`.
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
