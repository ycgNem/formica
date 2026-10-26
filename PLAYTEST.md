# Formica playtest report (v1.1 → v1.2)

A harsh playthrough of v1.1 "Living Meadow": in the browser, plus a headless harness (`npm run playtest`) that plays hundreds of in-game days with scripted keepers (idle, feeder, greedy and smart) and checks the sim's invariants every few seconds.

Each finding says what was wrong, how it showed up, and what changed.

---

## Bugs

| # | Bug | How it showed up | Fix |
|---|-----|------------------|-----|
| 1 | **Crash when a second rival lands.** After you destroy a rival, a new queen can land on the ruins of its nest. `planFounding` couldn't fit a chamber in the old tunnels and dereferenced `null`. | `TypeError: Cannot set properties of null (setting 'queenOnly')`, in about 1 in 3 long games where the player beat a rival. | New rivals land only on clear ground (`World.siteClear`). A queen who finds old tunnels underfoot walks on and looks again instead of crashing. |
| 2 | **Sugar-full deadlock.** Before the first food chamber, all stores share a 50 cap. Sugar filled it, so foragers stopped and protein had nowhere to go. The queen stopped laying and the colony slowly died. | Seeds stuck at 7–12 ants for a week, then dead. | Protein always gets in (it's fed straight to the brood) and sugar spills first. Foragers ignore sugar when the stores are full, and a colony short of protein forages and scouts harder. |
| 3 | **First food chamber could be blocked forever.** The "enough digging for now" budget applied before the colony had even one food store. | Tiny colonies with cap 50 for days. | The budget only applies once the colony has a nursery and a food store. |
| 4 | **Alates could block the win.** An alate knocked off course during the flight (a spider, a fight) went back to idling, and `flying` stayed true forever. | Nuptial flight never finished, so no victory. | A grounded alate during a flight sets off again. |
| 5 | **Alates flew through solid soil.** If an alate couldn't route out, `toFlight` launched it from underground. | Winged ants rising through the dirt. | They only take off once on the surface. |
| 6 | **Raiders stayed in the enemy nest.** After a raid, survivors idled forever in the rival's tunnels (and drowned there when it rained). | Dozens of "drowned" raiders after raids ended. | Ants outside their own nest head home. |
| 7 | **Dead ants crowded out food.** Every ant that died on the surface became its own food item. The food list is capped at 70, so after a surface battle no fruit or carcasses could spawn. | Battles followed by food droughts. | Dead ants pile up into one corpse heap per spot. |
| 8 | **Banner race.** Timers from a cleared banner could free the slot while a new banner was showing. | Two banners overlapping after quitting mid-celebration. | A generation counter ignores stale timers. |
| 9 | **The clock ran before you released the queen.** | Fruit piled up and the season ticked on the "release your queen" screen. | The meadow waits for the keeper. |
| 10 | **Toasts covered the inspector.** | Hints and day toasts stacked over the selected ant's card. | Toasts sit beside the left column. |
| 11 | **`raidDay` wasn't saved.** | A rival could raid twice on the same day after a reload. | Saved. |

## Loopholes

| # | Loophole | Fix |
|---|----------|-----|
| 1 | **Squish one-shot everything.** It killed a 120 HP wolf spider instantly, any number of ants in its radius (a whole raid party gathering at its rally point), and reached through the soil to kill ants underground. Squishing a beetle even counted for the "Big game" goal. | Surface only, at most four ants per squash, and big creatures take 50 damage instead of dying (a spider needs three). Squish kills don't count as your ants' hunting. |
| 2 | **Unlimited berry bushes at a flat 30.** With late-game points you could carpet the meadow for unlimited food. | Each bush costs 15 more than the last. |
| 3 | **Keeper points piled up** to 1,000–1,700 by day 36 with nothing to spend them on. | The escalating bush cost, the new Pebble tool and the 1.2+ features below all give points somewhere to go. |
| 4 | **Rain was cosmetic.** Flood water soaked away in about 4 seconds, so nothing ever drowned and the Leaf tool did nothing. "Weathered" was a free goal. | Water lingers about 20 s per cell, so a storm really fills the lower tunnels. Leaves now matter. |

## Balance

| Problem | Evidence | Change |
|---------|----------|--------|
| **The win came in the first summer.** | Fast species hit the nuptial flight on day ~5. At 30× that's 40 seconds. | Like real colonies, a colony must survive a winter before it raises alates. The flight now lands around day 15–16. |
| **"Superorganism" (1,000 ants) was unreachable.** | Every species plateaued at 450–580 ants because the egg rate was fixed. | Attendants feed the queen: her laying speeds up with the workforce (up to 2.5×), so protein becomes the real limit. Active players reach 1,000–1,400. |
| **Raids were binary and hopeless.** | An aggressive carpenter rival killed a Lasius player's queen by day 6–12 even with Defend focus. | New **Pebble** tool plugs an entrance (raiders and rain stay out, your foragers stay in). Calm rivals wait until after your first winter and need a much bigger edge. Raids give up sooner. Smart play now survives aggressive rivals about 3 times in 4. Idle play still loses. |
| **Nest planner built 7 food stores to 2 nurseries.** | | Chambers are planned from need: nurseries when brood outgrows them, stores when they fill. |
| **No feedback when the queen stopped laying.** | Protein hit 0 on day 1, brood stopped, and nothing said why. | Keeper hints (protein, floods, breaches, thin stores before winter) and a "No protein" alert. |

---

## Second pass: the v1.2 systems

The same harness, re-run after each roadmap feature went in, across every biome and species, plus probe scripts that stop the sim the moment something looks wrong. These came out of that.

### Bugs

| # | Bug | How it showed up | Fix |
|---|-----|------------------|-----|
| 12 | **One unreachable dig job stopped all digging for good.** Urgent projects (a tunnel to aphids, a cave-in to dig out) always came first. If its first cell had no dug neighbour to stand on, every worker picked it, failed and gave up. | A dunes colony of 130 workers dug nothing after founding, never got a food chamber past the 50 cap, and starved in its first winter. The trace showed `dig: 0` all game. | A worker who can't reach one project tries the next. Tunnels to aphids step round diagonal corners, so every cell has somewhere to stand. |
| 13 | **Starving colonies fetched protein while sugar ran out.** With protein at zero the colony always counted as "short of protein", which put mealworms and carcasses 40 points ahead of sugar when foragers chose a target. | Sugar water, fruit and berries lay untouched beside the nest for days while the colony starved. | When sugar is nearly gone, sugar comes first. |
| 14 | **Sand cave-ins could seal the colony in.** A collapse could cut the nest off from the entrance, and nobody could dig back because digging needs a standing cell connected to the way out. | 26 of 28 ants trapped in unconnected tunnels; the colony starved with food at the door. Ants also ended up inside solid sand. | A fall that would cut ants or brood off from the entrance doesn't happen. Ants whose path crosses a fall turn back. |
| 15 | **Army-ant lockdown starved colonies with empty stores.** Everyone stays inside while the column is near, which can be half a day. | 136 idle workers sat in the nest while the colony starved. | A starving colony still forages, at food well away from the column, and sends out more scouts. |
| 16 | **Lockdown loop.** Ants called in for army ants were called in again every second and never got home. | Dozens stuck on the surface "heading home" while the column passed. | Ants already on their way in are left alone. |
| 17 | **Lockdown lifted too early**, while the column was still just past the nest. | Foragers walked straight back into it. | The colony stays in until the column is well clear. |
| 18 | **Raiders drowned in the enemy's flooded nest.** | Whole raid parties lost to rain. | Raids are called off in heavy rain, and nobody sets out in it. |
| 19 | **Alarm recruitment death spiral.** Every bite pulled in a crowd, and young colonies threw themselves at enemies on the rival's own doorstep. | Early colonies lost half their workers to their own alarm calls. | Fewer recruits, far alarms ignored unless they're in home range, and enemies near their own nest left alone. |
| 20 | **Riverbank drowned 570 to 1,000 ants a game.** | Tunnels dug straight into the water table. | Digging stops above the water table, and groundwater rises faster in rain so the danger is visible. Now under 50. |
| 21 | **Big colonies starved in winter.** | 1,000-ant colonies lost hundreds every winter. | The colony digs stores to fit a winter's food, forages harder in autumn, and the queen slows down when stores are thin. |
| 22 | **The side panel opened over everything on phones.** The code collapsed it on small screens, then opening the first tab un-collapsed it. Toolbars and the new-game form overflowed sideways. | The whole phone screen covered by the panel. | Fixed order, plus a phone layout (below). |
| 23 | **Banners floated over open menus and photo mode.** | A "Winter" banner across the almanac. | Banners wait while a menu is open and hide in photo mode. |

### Balance

| Problem | Evidence | Change |
|---------|----------|--------|
| **Starvation killed a colony in about a minute.** Losses ramped from 1.2% to 3.6% of all ants every second. | Any brief gap in food wiped out half the colony before a keeper could react. | Losses build to at most 1% a second, which leaves time to drop sugar. |
| **Lineage traits came too easily.** | One good colony earned four of the six traits at once. | Two new traits a generation at most, with higher bars (1,500 ants, 6,000 cells dug, 250 kills, 12,000 food, a winter with no starvation, two winters). |
| **Fliers ignored the weather.** | Flights happened on any dry day. | Winged ants wait for a warm day just after rain, or any fair day after a long wait. |

### Results after the fixes

24 in-game days, smart keeper unless noted. Six seeds for the Lasius biome rows, four for the rest:

| Run | Survived | Nuptial flight | Notes |
|-----|----------|----------------|-------|
| Meadow, Lasius | 6 / 6 | 6 / 6, day 15.5 to 15.8 | 10–12 of 15 goals |
| Woodland, Lasius | 6 / 6 | 6 / 6 | |
| Dunes, Lasius | 6 / 6 | 6 / 6 | was 5 / 6 before fixes 12–14 |
| Riverbank, Lasius | 6 / 6 | 6 / 6 | was 5 / 6 |
| Dunes, big-headed ants | 4 / 4 | 4 / 4 | was 2 / 4 |
| Riverbank, fire ants | 4 / 4 | 4 / 4 | was 3 / 4 |
| Woodland, carpenter ants | 4 / 4 | 4 / 4 | |
| Meadow, aggressive rival | 3 / 4 | 3 / 4 | one queen killed by a carpenter raid |
| Meadow, honeypot, scarce food, feeder keeper | 3 / 4 | 3 / 4 | |
| Meadow, idle keeper | 2 / 4 | 0 / 4 | idle play is meant to lose |

A 48-day run (four years) across meadow, woodland (carpenter ants vs an aggressive rival), dunes (big-headed ants) and riverbank (fire ants), four seeds each: all 16 survived with no crashes or invariant failures. Populations peak at 1,000–1,400 and ease back to 400–600 by year four as the queens age, which is the intended effect.

**Known issue:** one meadow seed fought its rival for 30 days, lost 3,376 ants and was down to its queen by day 48. Neither side could finish the other. A war-weariness rule (rivals that keep losing raids stop raiding) would be the next thing to try.

---

## Harness

`npm run playtest -- <seeds> <days> <strategy> <species> <rival> <abundance> [flags]` prints one JSON line per game: milestones, the day each population mark was reached, deaths by cause, brood losses, raids, and any invariant violations. Invariants checked: no NaN or negative stores, no ants inside solid soil, project worker counts match reality, dig reservations held, and brood only in tunnels.

A seventh argument takes flags, comma-separated: `biome=dunes` picks the biome, `nodanger` turns off the v1.7 dangers to tell their effect apart, `only=N` runs just the Nth seed, and `trace` prints the colony's state four times a day (stores, tasks, intents, projects, unrouted ants and the food near the nest). Probe scripts can import `keeper()` from the harness to replay a game exactly.
