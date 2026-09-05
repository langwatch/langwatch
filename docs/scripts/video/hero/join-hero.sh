#!/bin/bash
# Builds the introduction hero: four polished beats with a full-frame title
# card in front of each, joined with xfade.
#
# The cards are full frame on purpose, so they are joined AFTER the polish
# step, not spliced into the source. Splicing them into a take would make the
# polish step draw them as a rounded window on a background, which is not a
# transition card.
set -e
W="$(cd "$(dirname "$0")/../../../.." && pwd)"
H="$W/.claude/tmp/video/hero"
C="$W/.claude/tmp/cards"
OUT="$W/docs/media/videos/introduction.webm"
T=0.4          # crossfade length
CARD=1.2       # how long a card is readable before its fade starts

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
d1=$(dur "$H/beat1.webm"); d2=$(dur "$H/beat2.webm")
d3=$(dur "$H/beat3.webm"); d4=$(dur "$H/beat4.webm")
cd_="$(echo "$CARD + $T" | bc)"
echo "beats: $d1 $d2 $d3 $d4  card: $cd_"

o1=$(echo "$cd_ - $T" | bc)
o2=$(echo "$o1 + $d1 - $T" | bc)
o3=$(echo "$o2 + $cd_ - $T" | bc)
o4=$(echo "$o3 + $d2 - $T" | bc)
o5=$(echo "$o4 + $cd_ - $T" | bc)
o6=$(echo "$o5 + $d3 - $T" | bc)
o7=$(echo "$o6 + $cd_ - $T" | bc)
echo "offsets: $o1 $o2 $o3 $o4 $o5 $o6 $o7"

N="format=yuv420p,fps=30,setsar=1"
F="[0:v]$N[c1];[1:v]$N[b1];[2:v]$N[c2];[3:v]$N[b2];\
[4:v]$N[c3];[5:v]$N[b3];[6:v]$N[c4];[7:v]$N[b4];\
[c1][b1]xfade=transition=fade:duration=$T:offset=$o1[x1];\
[x1][c2]xfade=transition=fade:duration=$T:offset=$o2[x2];\
[x2][b2]xfade=transition=fade:duration=$T:offset=$o3[x3];\
[x3][c3]xfade=transition=fade:duration=$T:offset=$o4[x4];\
[x4][b3]xfade=transition=fade:duration=$T:offset=$o5[x5];\
[x5][c4]xfade=transition=fade:duration=$T:offset=$o6[x6];\
[x6][b4]xfade=transition=fade:duration=$T:offset=$o7,fps=30[out]"

ffmpeg -y -v error \
  -loop 1 -t "$cd_" -i "$C/card1.png" \
  -i "$H/beat1.webm" \
  -loop 1 -t "$cd_" -i "$C/card2.png" \
  -i "$H/beat2.webm" \
  -loop 1 -t "$cd_" -i "$C/card3.png" \
  -i "$H/beat3.webm" \
  -loop 1 -t "$cd_" -i "$C/card4.png" \
  -i "$H/beat4.webm" \
  -filter_complex "$F" -map "[out]" \
  -an -c:v libvpx-vp9 -b:v 0 -crf 36 -deadline good -cpu-used 2 -row-mt 1 \
  -pix_fmt yuv420p -r 30 "$OUT"

ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
echo "$OUT"
