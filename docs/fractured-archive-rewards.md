# Fractured Archive reward preview

The proposed combat rewards are available before their wiki equipment records exist. Their
fallback stats live in `scripts/manual_equipment.json` and are based on the
[official rewards poll blog](https://secure.runescape.com/m=news/the-fractured-archive---rewards-poll-blog?oldschool=1)
and its linked stat images. These entries have negative temporary IDs. Equipment loaded from
`cdn/json/equipment.json` takes precedence by item name and slot. The equipment generator
uses the same rule, and saved loadouts with temporary IDs resolve by name after real IDs arrive.
The SVG equipment pictures in `cdn/equipment` are local preview icons based on the reward
concepts, so wiki item sprites and images will replace them with the upstream records.

Implemented in the calculator:

- Elemental Fragments: four independent toggles in Extra Options add 2 to the matching
  elemental spell's base max hit.
- Rondache: proposed combat stats and 2 flat damage reduction against typed incoming hits.
- Zorya's Tome: powered staff stats and a base max hit of `floor(Magic level / 3) - 10`
  (minimum 1), before the Tome's 15% Magic damage bonus. Its special attack groups
  the initial hit and three independently rolled follow-ups into one four-hit result.
  The follow-ups occur only if the initial hit lands, and expected attack time includes
  their two-tick intervals.
- Zeal: 25% Attack, 28% Strength, 25% Defence and Piety's drain rate. The calculator does not
  enforce prayer unlock requirements.
- Ascension crossbows: heavy ranged, rapid 2 tick attacks, dedicated regular, diamond, and
  onyx Ascension bolts, and halved enchanted bolt proc rates.
- The Obligator (the Breaker's chosen appearance): Thrust rolls damage 2–4 times according
  to the target's relative melee defences and gains 20% or 40% damage against larger targets.
  Smash attacks every 3 ticks without either Thrust effect.

The current single-target DPS model cannot represent the Obligator hitting separate NPCs
in a line. Rondache Shield Bash and its charge accumulation are also outside the current
weapon-special model, which only calculates specials from the weapon slot. Zorya's
grouped special assumes all four hits target the same NPC; the in-game follow-ups can
be aimed at separate targets. Update these calculations
when final in-game mechanics are published.
