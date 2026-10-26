# Art sources

Raw PixelLab output for v1.1 and the scripts that turn it into the game's art in `src/art/`.

- `dl/`: original generations (trees, sprite sheets, backdrops, icons and portraits).
- `anim/`: walk-cycle frames from `animate_image` (`<name>_0` is the input frame).
- `seg/`: sprite sheets cut into single sprites by `tools/seg.py`.
- `tools/`: the pipeline, run with Pillow from this folder.

Rebuild everything (paths are arguments, so run it from anywhere):

```bash
python -P tools/atlas.py <path to art-src> <path to src/art>
```

```bash
python -P tools/uiicons.py <path to art-src> <path to src/art/ui>
```

`atlas.py` lists which sprite comes from which file, keys out flat backgrounds and packs `atlas.png` plus `atlas.json`. It also writes the mirrored, seamless `hills.png` and `hedge.png` strips. To add a sprite, drop the PNG in `dl/` (or segment a sheet with `tools/seg.py sheet.png seg prefix`), add a line to `atlas.py`, and rebuild. Sprites are drawn at 8 texels per world cell (`TEX` in `src/sprites.ts`), so paint them at that scale. Seasonal looks (blossom, autumn, snow, wilt, bare) are recoloured at load time in `src/sprites.ts`, so only one painted version is needed.

`tools/sheet.py out.png <scale> files...` makes a contact sheet for reviewing new art.
