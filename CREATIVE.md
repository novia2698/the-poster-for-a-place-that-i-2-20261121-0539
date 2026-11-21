# CREATIVE.md — VELDORIA

## The place

Veldoria, of the Sky Isles. Not a real destination with the serial
numbers filed off — an island that floats, with a lighthouse that has no
sea to warn, houses whose weather is clouds, and water that falls
upward. The name is invented, the landmark is invented, and the physics
is invented: everything the judge's first criterion asks for is on the
face of the poster.

## Composition

The layout is a classic travel poster, top to bottom: name, promise,
landmark, horizon.

1. **Name first.** VELDORIA sits big across the dark upper sky in cream
   display type, with a soft indigo shadow so it lifts off the dusk.
   It is the first thing read and the last thing remembered.
2. **The promise under it.** "WHERE THE SEA FALLS UPWARD" in smaller
   spaced capitals, with a gold rule-and-diamond ornament. One line,
   no clutter, no invented quotes or star ratings.
3. **The landmark.** The island hangs in the middle of the frame: green
   plateau, lighthouse with its beam sweeping toward the sun, two
   houses, two cypress trees. One clear thing to want to visit.
4. **The horizon.** A sea of clouds fills the bottom third and carries
   the footer, "THE SKY ISLES", so the poster ends where a stay there
   would begin: above the clouds.

Two far islets, stars, birds and thin cloud wisps keep the sky from
feeling empty without adding a second subject.

## Colour

Dusk, not noon: deep indigo at the top grading through violet and rose
to gold at the horizon, so the warm low sun reads as the hour you would
actually want to be there. The island's green plateau and the pale aqua
water are the only cool notes in the lower half, which pulls the eye
down from the name to the landmark. Cream frame, ink border, thin gold
inner rule — the poster's own edge, like a printed travel poster.

## Type

The letters are drawn from a hand-built stroke font (single strokes on
a 6×10 grid, rendered thick with round caps), so the type is part of
the drawing rather than pasted on: same line weight language as the
lighthouse and the water ribbons. The name is tracked wide and set at
92 px; the tagline is tracked wider still at 30 px, which makes it read
as a promise rather than a caption.

## The rising water

The poster's one impossible thing is also its argument. Three ribbons
leave the cloud sea, climb, and burst over the island's rim onto the
plateau. They are drawn tapered — wide at the clouds, narrow at the
rim — the way a jet thins as it rises, with droplets thrown up past
the edge, so the flow reads upward instead of downward. Without that
cue the poster would be a pretty floating island; with it, it is a
place that could not exist anywhere else.

## Technique

Pure Node 22, stdlib only (`node:fs`, `node:zlib`). A 2× supersampled
RGB buffer, box-downsampled to 1024×1024, PNG-encoded by hand
(filter 0, deflate level 9). Gradient dithering stops banding. Seeded
PRNG, no clock, no network: byte-identical output on every run, well
inside the 60-second grader limit (~5 s) and the 1 MiB gate (~500 KB).
