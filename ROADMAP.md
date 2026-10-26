# Formica roadmap

Where the game is going after 1.0, and the real ant biology each update is built on.

---

## v1.1 "Living Meadow" (built)

A graphics, environment and UI pass. The sim stays the same, so saves from 1.0 still load. The art is 44 PixelLab generations, and the sources and pack scripts are in `art-src/`.

**Terrain**
- The soil renders at 8 texels per cell (it was 1). Strata are textured and noisy, with pebbles, grit and roots. The deep clay darkens toward a bedrock band.
- Tunnels have smooth, chamfered walls instead of stair-step pixels. They get a packed-earth floor, a shadowed ceiling, ambient occlusion on the walls, and a faint tint for each chamber role.
- Spoil mounds read as loose crumbs. Stones are shaded with a light top and a dark underside. Flood water has a bright surface line.
- The ground surface has a grass lip that follows the season (green, gold, amber, then snow).

**Surface map (built out, no empty ground)**
- Layered scenery from back to front: sky, far hills, near hedgerow, trees, bushes, props, ground cover, then the ants.
- PixelLab sprites replace the vector trees, bushes and flowers, and add new props: fallen logs, stumps, stones, mushrooms, ferns, clover and tall grass.
- Every seed lays out zones across the meadow: woodland edge, open meadow, a stony patch and a bramble hedge.
- Seasonal looks: blossom in spring, fruit in summer, leaf colour in autumn, bare branches and snow caps in winter.

**Creatures and food**
- Sprite beetles, caterpillars and wolf spiders with walk cycles.
- Sprite food: apples, blackberries, seeds, mealworms, sugar drops and insect carcasses.

**Atmosphere**
- Parallax far hills and hedgerow, tinted by time of day, plus sprite clouds.
- Ambient life: butterflies by day, fireflies on summer nights and falling leaves in autumn.
- Rain splashes, wet darkening after storms, and snow that settles.
- Dust puffs when ants dump spoil.

**UI**
- Pixel-art icons on tools, resources, seasons and weather. Species portraits on the colony card and in the species picker, and a queen on the title screen.
- Numbers count up and pop when they rise. Earning keeper points sends up a floating "+N" with a coin blip, and spending them shows "-N".
- Goals: a "Goal complete" banner with confetti and the reward, a next-goal progress bar on the colony card, and progress bars in the Goals tab.
- A season-change banner.
- Springier buttons, tools that lift and tilt their icon on hover, and accent colours from your species.
- Colour-coded workforce bars, a sliding tab underline, toasts with icons and a countdown line, and a version chip.

**Fixes**
- The camera no longer turns into NaN when the page loads in a hidden or zero-size window.

---

## v1.2 "Wider World" (built)

Everything in the expansion list below except the desktop wrapper, built in one release, plus the fixes from a harsh playtest (see `PLAYTEST.md`). Saves from 1.1 still load: new fields are optional and fill in with defaults.

**Biomes (v1.2).** The new-game menu picks a meadow, woodland floor, sandy dunes or riverbank. Each has its own soil palette, grass, plants, critter mix, weather and temperature. Woodland has rotting logs that carpenter ants chew through and leaf litter that hides foragers from birds. Dune sand digs fast but caves in now and then, so tunnels get dug out again; rain is rare but floods hard, and antlion pits are everywhere. Riverbank silt sits on a high water table: tunnels below it fill with groundwater.

**Division of labour (v1.3).** Workers age from nurse to builder to forager, and each has her own response threshold for every job, so specialists ("Obsessive digger") emerge. Soil temperature changes with depth and time of day, and nurses carry brood to the warmest nursery.

**Food (v1.4).** Foragers carry sugar in their crops and share it mouth to mouth. Honeypot ants grow repletes. Root aphids can be found or released and milked for honeydew, rain or shine, and ladybirds come for them. Seed harvesters fill granaries that majors crack open.

**Pheromones (v1.5).** Trails strengthen with food quality and fade; small colonies tandem-run and big ones mass-recruit. Alarm scent pulls in nearby defenders, and a home-range scent marks territory. P toggles a scent view and a soil-warmth view.

**Lineage (v1.6).** Winged queens and males fly on a warm, humid day just after rain. After the flight you can follow a daughter queen: a new game on the next patch of ground with up to four inherited traits (two new ones a generation, earned by how the mother colony lived), and the mother colony next door as a friendly neighbour. Queens slow down after their second year. A queen who dies with 30+ workers left leaves them to raise a last brood of males.

**Danger (v1.7).** Antlion pits (a nestmate can pull a victim out), centipedes that hunt brood in the tunnels, robins that peck foragers in the open, ladybirds that eat aphids, and a summer army-ant raid that pours into any open entrance. Fire ants raft the queen to high ground when the nest floods.

**Quality of life.**
- A Graphs tab: population (yours, the rival's and your mother colony's), stores and losses over time, with season bands. Saved with the game.
- Photo mode (H): the UI steps aside, the clock stops, a slider moves the light through the day, a vignette or polaroid frame, and Save picture writes a PNG.
- An almanac of 34 entries (species, creatures, places and behaviours), each unlocked the first time you see it in a game.
- Sandbox mode: free tools and a panel to summon any creature, army ants, rain or the next season, or top up the colony.
- A sound pass: a wind bed, birdsong on spring and summer days, crickets on warm nights, and the scratch of digging when the camera is close.
- Touch and phones: pinch to zoom, drag to pan, tap to inspect, and a phone layout with the panel as a bottom sheet and a scrolling tool tray.
- An itch-ready build (relative asset paths, so `dist/` runs from any folder) and save export and import in Settings.
- New goals: Living raft, No ant left behind, Held the line, Dynasty and Last gasp.

**Still to do:** a desktop wrapper (Tauri or Electron) for Steam, and cloud saves.

---

## How a real colony works (research notes)

Short summaries. Sources are listed at the bottom.

1. **Colony life cycle.** A colony goes through three stages:
   - *Founding:* the queen raises the first workers alone.
   - *Ergonomic:* all effort goes into growing the colony.
   - *Reproductive:* the colony starts making new queens (gynes) and males.

   Females come from fertilised eggs and males from unfertilised ones (haplodiploidy).
2. **Claustral founding.** A *Lasius niger* queen seals herself in and lives off her wing muscles and fat reserves. Her first workers, called nanitics, are small, and there are few of them. Queens that get fed raise more of them.
3. **Age polyethism.** Young workers nurse deep in the nest and drift outward with age. The oldest workers forage. The pattern bends to need: if foragers die off, young ants start foraging early. Forced back into nursing, old foragers rarely switch again.
4. **Response thresholds.** Each worker takes up a task when the stimulus for it (hungry larvae, an open dig face) passes her personal threshold. Varied thresholds give a smooth, self-organising split of labour.
5. **Nest layout by age.** Tschinkel's casts show brood and the queen in the deeper chambers with the youngest workers. The oldest workers sit in the top chambers near the exit. In *Pogonomyrmex*, the biggest and busiest chambers are near the top.
6. **Brood thermoregulation.** Nurses carry brood up and down the nest as the soil warms and cools through the day, pupae first, then larvae, then eggs. It costs real energy.
7. **The social stomach.** Foragers carry liquid food in the crop and pass it mouth to mouth (trophallaxis). The whole colony's crops act as one shared store. Honeypot ants take this to the extreme with repletes: living storage jars that hang from the ceiling.
8. **Pheromone trails.** A trail is laid stronger to better food, fades in about an hour, and dies once the food runs out. Alarm pheromone is a separate signal. Small colonies tandem-run (one leader, one follower). Large colonies mass-recruit.
9. **Necrophoresis.** Corpses are carried to middens. The trigger is the smell of decay (oleic acid) or the loss of the "alive" scent about an hour after death.
10. **Aphid farming.** *Lasius niger* herds root aphids for honeydew, which is its main sugar source.
11. **Winter.** Temperate colonies go dormant from about October to March. They cluster deep, stop laying and live off stored fat.
12. **Nuptial flights.** Flights happen on warm, humid, still days, often after rain, so new queens find soft ground to dig. Queens mate with several males and store sperm for life. Queens live 15+ years in the wild and 28 in captivity.
13. **Species quirks worth a mechanic:**
    - Fire ants link bodies into waterproof rafts in floods, with the queen in the middle and brood helping them float.
    - *Pheidole* majors crack seeds, which are stored in granaries.
    - Carpenter ants carve galleries in wood.
    - Queenless workers lay male eggs.

---

## Expansion angles (post 1.1)

Ordered roughly by fun-per-effort. Each one leans on a research note above (the number in brackets).

### v1.2 Biomes (built)
New colonies pick a biome. Each one swaps the soil palette, the plants, the critters, the weather and what the soil does.
- **Meadow** (current): balanced.
- **Woodland floor**: rotting logs that carpenter ants can tunnel into [13]. Leaf litter for cover, fungus and centipedes.
- **Sandy dunes**: fast digging but tunnels can collapse, so ants have to shore them up. Hot days push brood deep [6]. Little rain, big flash floods, antlion pits.
- **Riverbank**: a high water table and floods. Fire ants can raft [13].

### v1.3 Real division of labour (built)
- **Age polyethism [3, 5]:** workers are born as nurses, then become diggers and then foragers as they age. The inspector shows each ant's age band. Losing foragers in a raid pulls young ants out early, which shows up visibly.
- **Response thresholds [4]:** each ant gets a random threshold per task. This replaces the global task weights and makes emergent specialists like "Bertha the obsessive digger".
- **Brood thermoregulation [6]:** soil temperature varies with depth and time of day. Nurses shuttle pupae up into warm shallow chambers at midday and back down at night. Brood in the wrong temperature develops slower. The player sees a daily tide of brood moving.

### v1.4 Food that behaves like food (built)
- **Social stomach [7]:** foragers carry sugar in their crops, not as pellets, and share it through trophallaxis chains. The "Stores" number becomes the sum of crop contents plus granary stock.
- **Repletes:** honeypot species get a replete caste that hangs in storage chambers.
- **Aphid ranching [10]:** root aphids live on plant roots underground. Ants tunnel to them, guard them and milk honeydew. They're a steady sugar income worth defending from ladybirds.
- **Granaries [13]:** seed harvesters store seeds, and majors crack them.

### v1.5 Pheromones you can see (built)
- **Separate channels [8]:** food trails strengthen with food quality and fade in about an hour of game time. Alarm pheromone shows up as a red bloom when an ant is attacked and pulls in nearby defenders. A home-range scent marks your territory.
- **Recruitment styles:** tandem runs in small colonies, mass recruitment past about 100 workers.
- A **pheromone view** toggle (heat-map overlay).

### v1.6 Lineage mode (the long game) (built)
- **Real reproductive stage [1, 12]:** after the ergonomic stage the colony raises gynes and males. Flights trigger on warm, humid, still days after rain.
- **Found a daughter colony:** after a flight, pick one of your queens to follow. You start a new game on a neighbouring map with inherited traits. Your old colony becomes a friendly or rival neighbour.
- **Queen ageing:** queens slowly lose egg rate after years of game time. Losing her late in life lets workers lay male eggs as a last gasp [13].

### v1.7 Danger and drama (built)
- **Antlions** in sand, **centipedes** underground, **birds** that peck foragers on open ground, **ladybirds** that eat your aphids.
- **Army ant raid** event: a bivouac moves through the map and the colony must evacuate brood.
- **Flood rafts** for fire ants [13]: when the nest floods, they raft up and float the queen to high ground.

### Quality of life and polish
- Colony graphs: population, food and deaths over time. *(Built.)*
- A photo mode that hides the UI, with time-of-day scrub and a frame. *(Built.)*
- An almanac: an encyclopedia page for each species, critter and behaviour, unlocked by seeing it in game. The research notes above go here. *(Built.)*
- Sandbox mode: infinite keeper points and spawn anything. *(Built.)*
- Sound pass: ambient meadow day and night loops, and digging scratch. *(Built.)*
- Mobile and touch controls, plus a fit-to-phone HUD. *(Built.)*
- Steam or itch build (Tauri or Electron wrapper) with cloud saves. *(The itch-ready build and save export/import are built; the desktop wrapper and cloud saves are not.)*

---

## Sources

- Age polyethism and response thresholds: [PMC9202139 (Diacamma, 2022)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9202139/), [Polyethism in artificial ants (arXiv 1104.3152)](https://arxiv.org/pdf/1104.3152), [Lenoir 1979, Tapinoma](https://dictionnaire-amoureux-des-fourmis.fr/Noms%20propres/L/Lenoir%20Alain/Publis%20Alain%20lenoir/Lenoir-IS1979.pdf)
- Lasius niger founding, aphids and hibernation: [antkeeping.info: Lasius niger](https://antkeeping.info/ants/lasius-niger/), [AntStore: Lasius niger](https://www.antstore.net/shop/en/ants/Ants-from-Central-Europe/Lasius-niger--Black-Garden-Ant-.html)
- Brood thermoregulation: [Thermoregulation in ants (PMC3962001)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3962001/)
- Nest architecture: [Tschinkel, Ants as artists and architects (Princeton)](https://press.princeton.edu/node/45649), [Tschinkel 2017, Ecology](https://www.bio.fsu.edu/Tschinkel/4%20Scientific%20Naturalist%202017-Ecology.pdf), [Odontomachus brunneus nests](https://bioone.org/journals/journal-of-insect-science/volume-10/issue-64/031.010.6401/The-Nest-Architecture-of-the-Ant-Odontomachus-brunneus/10.1673/031.010.6401.short)
- Trophallaxis and repletes: [AntWiki: Trophallaxis](https://antwiki.org/wiki/Trophallaxis), [AntWiki: Repletes](https://antwiki.org/wiki/Repletes), [Food dissemination (Feinerman lab)](https://www.weizmann.ac.il/complex/feinerman/research/food-dissemination)
- Pheromone trails and tandem running: [Wikipedia: Trail pheromone](https://en.wikipedia.org/wiki/Trail_pheromone), [Tandem running in Temnothorax (2017)](https://www.iiserkol.ac.in/~antlab/publications/Characterisation%20of%20recruitment%20through%20tandem%20running%202017.pdf)
- Necrophoresis: [Wikipedia: Necrophoresis](https://en.wikipedia.org/wiki/Necrophoresis), [Gordon 1983](https://web.stanford.edu/~dmgordon/previous/Gordon1983Dependence.pdf)
- Colony life cycle and haplodiploidy: [AntWiki: The Ant Life Cycle](https://antwiki.org/wiki/The_Ant_Life_Cycle), [Australian Museum: Ant colonies](https://australian.museum/learn/animals/insects/ant-colonies/)
- Nuptial flights: [Wikipedia: Nuptial flight](https://en.wikipedia.org/wiki/Nuptial_flight), [Smithsonian: flying ants on rain radar](https://www.smithsonianmag.com/smart-news/swarms-flying-ants-overtaking-great-britain-show-rain-radar-180972686/)
- Fire ant rafts: [Mlot et al. 2011 (PMC3093451)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3093451), [eXtension: fire ants in floods](https://ant-pests.extension.org/what-happens-to-fire-ants-during-a-flood)
- Pheidole seed milling: [Holley et al. 2016](https://www.moreaulab.entomology.cornell.edu/wp-content/uploads/2016/05/Holley_et_al._2016_Biol_J_Linn_Soc.pdf), [Big-headed ants and their big heads](https://dailyant.com/2016/12/30/big-headed-ants-and-their-big-heads/)
