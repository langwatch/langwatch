#!/bin/bash
# Builds the four full-frame transition cards for the introduction hero.
#
# The nexus image-generation endpoint takes only blog-cover / linkedin /
# og-image and its own house rules forbid text in the pixels, so a title card
# is not something it can make. The cards are drawn here instead: the docs
# background, a soft light plate, and the title in SF Pro Display Semibold,
# rasterised with rsvg-convert, which the polish pipeline already needs.
set -e
W="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$W/.claude/tmp/cards"
BG="$W/docs/scripts/video/backgrounds/default.webp"
Wd=1664
Ht=1040
mkdir -p "$OUT"

# The background scaled and cropped to the output canvas, then dimmed a little
# so a dark title reads over every part of it.
ffmpeg -y -v error -i "$BG" \
  -vf "scale=${Wd}:${Ht}:force_original_aspect_ratio=increase,crop=${Wd}:${Ht}" \
  "$OUT/bg.png"

make_card() {
  name="$1"
  title="$2"
  cat > "$OUT/$name.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$Wd" height="$Ht" viewBox="0 0 $Wd $Ht">
  <defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
  </defs>
  <ellipse cx="832" cy="520" rx="560" ry="190" fill="#ffffff" opacity="0.55" filter="url(#soft)"/>
  <text x="832" y="520" text-anchor="middle" dominant-baseline="central"
        font-family="SF Pro Display, SF Pro Text, Helvetica Neue, Helvetica, sans-serif"
        font-weight="600" font-size="112" letter-spacing="-2" fill="#1a1a1a">$title</text>
</svg>
SVG
  rsvg-convert -w $Wd -h $Ht -o "$OUT/$name-text.png" "$OUT/$name.svg"
  ffmpeg -y -v error -i "$OUT/bg.png" -i "$OUT/$name-text.png" \
    -filter_complex "[0:v]format=rgba[b];[b][1:v]overlay=0:0,format=yuv420p[o]" \
    -map "[o]" -frames:v 1 "$OUT/$name.png"
  echo "$OUT/$name.png"
}

make_card card1 "Traces"
make_card card2 "Evaluations"
make_card card3 "Agent testing"
make_card card4 "AI Gateway"
