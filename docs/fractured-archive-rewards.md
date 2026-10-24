# Fractured Archive data and mechanics

The released rewards now use the OSRS Wiki calculator's generated equipment records in
`cdn/json/equipment.json`, including real item IDs, stats, and inventory icons. The seven
negative-ID reward previews have been removed from `scripts/manual_equipment.json`. Saved
loadouts using those temporary IDs map to the released items during import.
Older saved selections for Archive Guardian, Dagon'hai Monk, and Ocellus phase 1 also
map from provisional NPC IDs to the Wiki IDs.

Most Fractured Archive NPCs likewise use upstream records and portraits from
`cdn/json/monsters.json`. These replace the provisional stats where they differ, including
the Archive Guardian's Flying and Grounded variants, Dagon'hai Monk variants, and Ocellus
phase 1's corrected ID. Only NPCs still absent from the upstream snapshot retain `Frac`
fallback entries in `scripts/manual_monster.json`:

- Inert Guardian
- Cauldron
- Imp
- Demonic rift
- Animated Sword
- Ocellus phase 2
- The Blade

The remaining manual NPCs still have unknown attack styles, maximum hits, melee attack
bonuses, and attack speeds where the Wiki has no data. An attack speed of 0 marks an
unknown value and is excluded from damage-taken calculations. The monster generator skips
a fallback once an upstream record has the same ID or name and version.

Implemented in the calculator:

- Elemental Fragments: four independent toggles in Extra Options add 2 to the matching
  elemental spell's base max hit.
- Rondache: 2 flat damage reduction against typed incoming hits.
- Zorya's Tome: powered staff stats and a base max hit of `floor(Magic level / 3) - 10`
  (minimum 1), before the Tome's 15% Magic damage bonus. Its special attack groups
  the initial hit and three independently rolled follow-ups into one four-hit result.
  The follow-ups occur only if the initial hit lands, and expected attack time includes
  their two-tick intervals.
- Zeal: 25% Attack, 28% Strength, 25% Defence and Piety's drain rate. The calculator does not
  enforce prayer unlock requirements.
- Ascension crossbows: heavy ranged, rapid 2 tick attacks, dedicated regular, diamond, and
  onyx Ascension bolts, and halved enchanted bolt proc rates.
- Obligator: Thrust rolls damage 2–4 times according
  to the target's relative melee defences and gains 20% or 40% damage against larger targets.
  Smash attacks every 3 ticks without either Thrust effect.

The current single-target DPS model cannot represent Obligator hitting separate NPCs
in a line. Rondache Shield Bash and its charge accumulation are also outside the current
weapon-special model, which only calculates specials from the weapon slot. Zorya's
grouped special assumes all four hits target the same NPC; the in-game follow-ups can
be aimed at separate targets. Update these calculations
when final in-game mechanics are published.
