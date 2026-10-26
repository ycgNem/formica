"""Crop the chosen UI icons and portraits into src/art/ui. python uiicons.py <scratchpad> <out>"""
import sys, os
from PIL import Image
SP, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
def crop(p):
    im = Image.open(p).convert('RGBA')
    bb = im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
    return im.crop(bb)
pick = {
    'tool_inspect': 'dl/icon_inspect', 'tool_sugar': 'seg/itool_1', 'tool_protein': 'seg/itool_2', 'tool_leaf': 'seg/itool_5',
    'tool_bush': 'seg/itool_6', 'tool_dig': 'seg/itool_7', 'tool_squish': 'seg/itool_8', 'honey': 'seg/itool_9',
    'medal': 'seg/iui_0', 'season_0': 'seg/iui_1', 'season_1': 'seg/iui_2', 'season_2': 'seg/iui_3', 'season_3': 'seg/iui_5',
    'rain': 'seg/iui_6', 'moon': 'seg/iui_7', 'heart': 'seg/iui_8',
    'ant_lasius': 'dl/ant_lasius', 'ant_camponotus': 'dl/ant_camponotus', 'ant_pheidole': 'dl/ant_pheidole2',
    'ant_solenopsis': 'dl/ant_solenopsis', 'ant_queen': 'dl/ant_queen',
}
for name, src in pick.items():
    im = crop(f'{SP}/{src}.png')
    im.save(f'{OUT}/{name}.png', optimize=True)
    print(name, im.size)
